const {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback
} = React;

/* ---------- design tokens ---------- */
const C = {
  ink: "#2B2A28",
  inkSoft: "#5C574C",
  parchment: "#EDE7D8",
  card: "#F8F5EC",
  rule: "#D9D0BC",
  sage: "#6E7B5E",
  sageDeep: "#4F5A43",
  plum: "#7A3B45",
  mustard: "#B5842A",
  white: "#FFFDF8",
  slate: "#5B6B78",
  slateDeep: "#44525C",
  taupe: "#8C8474",
  sageTint: "#E3EBDD",
  plumTint: "#F0DEE0",
  slateTint: "#E1E7EA",
  taupeTint: "#ECE7DC"
};
/* quick-add duplicate check: finds open tasks whose title overlaps what's being typed ("weeds" ~ "Check weeds") */
const QA_STOP = new Set(["the", "a", "an", "to", "and", "of", "for", "my", "our", "in", "on", "up", "out"]);
const qaTokens = str => String(str || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w && !QA_STOP.has(w)).map(w => w.length > 3 ? w.replace(/(es|s)$/, "") : w);
const QA_GENERIC = new Set(["check", "clean", "wash", "buy", "fix", "get", "put", "make", "do", "empty", "sort", "tidy", "take", "change", "replace", "order", "book", "call", "organise", "organize"]);
function findSimilarTasks(query, candidates) {
  const q = qaTokens(query);
  if (!q.length || query.trim().length < 3) return [];
  const last = q.length - 1;
  const qHas = tt => q.every((w, i) => tt.some(x => x === w || i === last && w.length >= 3 && x.startsWith(w)));
  return candidates.filter(t => {
    const tt = qaTokens(t.title);
    if (!tt.length) return false;
    const titleInQuery = tt.every(x => q.some(w => w === x));
    if (qHas(tt) || titleInQuery) return true;
    // partial overlap ("weeds in the garden" ~ "Check weeds"): needs a meaningful shared word, not just a generic verb
    const shared = q.filter(w => tt.includes(w));
    return shared.some(w => !QA_GENERIC.has(w)) && shared.length >= Math.ceil(Math.min(q.length, tt.length) / 2);
  }).slice(0, 4);
}
/* which All tasks list a task belongs in: Household chores / Personal chores, Shared / Personal projects */
function sectionForTask(t) {
  if (t.listType === "chore") return t.scope === "personal" ? "personalTasks" : "household";
  return t.scope === "personal" ? "personal" : "shared";
}
const SECTION_LABELS = {
  household: "Household chores",
  personalTasks: "Personal chores",
  shared: "Shared projects",
  personal: "Personal projects"
};
const TYPE_CHOICES = ["household", "personalTasks", "shared", "personal"].map(k => [k, SECTION_LABELS[k]]);
/* "Skip" in overwhelmed mode only hides a card until local midnight — remembered on this device, per person, and never
   touches the task itself. The key includes the local date so it resets by itself the next day. */
/* All dates in the app are Adelaide dates. "Today" is read in Australia/Adelaide time (not UTC, which runs up to 10.5h
   behind and used to make "today" flip at ~10:30am), and date arithmetic round-trips through local components only. */
const adelaideToday = () => new Date().toLocaleDateString("en-CA", {
  timeZone: "Australia/Adelaide"
});
const ymdLocal = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const skipStorageKey = person => `lifelist-skipped-${person}-${adelaideToday()}`;
const loadSkipped = person => {
  try {
    return JSON.parse(localStorage.getItem(skipStorageKey(person)) || "[]");
  } catch (e) {
    return [];
  }
};
const saveSkipped = (person, list) => {
  try {
    localStorage.setItem(skipStorageKey(person), JSON.stringify(list));
  } catch (e) {}
};
const APP_VERSION = "v54";
const PEOPLE = {
  jade: "Jade",
  john: "John"
};
const PERSON_COLOR = {
  jade: C.sage,
  john: C.plum
};
const PERSON_CODE = {
  jade: "JC",
  john: "JE"
};
/* consistent colour-by-person across filter chips and section headers: jade=green, john=maroon, shared/all=slate, unassigned=taupe grey */
function filterColor(key) {
  if (key === "jade") return C.sage;
  if (key === "john") return C.plum;
  return C.slate;
}
/* the same colour, but as a quiet tint for backgrounds — keeps the colour-coding without the visual weight */
function filterTint(key) {
  if (key === "jade") return C.sageTint;
  if (key === "john") return C.plumTint;
  return C.slateTint;
}
const BUCKETS = [{
  key: "quick",
  label: "Quick"
}, {
  key: "mid",
  label: "Middle-term"
}, {
  key: "long",
  label: "Long-term"
}];
const DEFAULT_ROOMS = ["Kitchen", "Bathroom", "Living", "Bedroom", "Laundry", "General"];
const DEFAULT_CATEGORIES = ["General"];
const RECUR_UNITS = [["none", "Never"], ["day", "Days"], ["week", "Weeks"], ["month", "Months"]];
const IMPORTANCE = [{
  key: "high",
  label: "High",
  color: C.plum
}, {
  key: "med",
  label: "Med",
  color: C.mustard
}, {
  key: "low",
  label: "Low",
  color: C.sage
}];
const uid = () => Math.random().toString(36).slice(2, 10);
const capFirst = s => s && s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const nextAction = task => (task.actions || []).find(a => !a.completed) || null;
/* a chore's true urgency for to-do-list purposes is the EARLIER of its own due date and its next incomplete
   subtask's due date — a subtask due sooner than the parent should surface the parent sooner too. */
function effectiveDueDate(task) {
  const na = nextAction(task);
  const subDate = na ? na.dueDate : null;
  if (subDate && task.dueDate) return subDate < task.dueDate ? subDate : task.dueDate;
  return subDate || task.dueDate || null;
}
/* the specific subtask driving a chore's urgency, if it's an earlier date than the chore's own — null otherwise */
function drivingSubtask(task) {
  const na = nextAction(task);
  if (!na || !na.dueDate) return null;
  if (!task.dueDate) return na;
  return na.dueDate < task.dueDate ? na : null;
}
const actionsProgress = task => {
  const acts = task.actions || [];
  if (!acts.length) return null;
  return `${acts.filter(a => a.completed).length}/${acts.length} subtasks`;
};
const moveAction = (actions, idx, dir) => {
  const arr = actions.slice();
  const j = idx + dir;
  if (j < 0 || j >= arr.length) return arr;
  [arr[idx], arr[j]] = [arr[j], arr[idx]];
  return arr;
};
/* normalize both the new {unit, amount, mode} shape and the old fixed-string shape from earlier versions */
function normRecurrence(r) {
  if (!r) return {
    unit: "none",
    amount: 1,
    mode: "rolling"
  };
  if (typeof r === "string") {
    const map = {
      none: ["none", 1],
      daily: ["day", 1],
      weekly: ["week", 1],
      fortnightly: ["week", 2],
      monthly: ["month", 1]
    };
    const [unit, amount] = map[r] || ["none", 1];
    return {
      unit,
      amount,
      mode: "rolling"
    };
  }
  return {
    unit: r.unit || "none",
    amount: r.amount || 1,
    mode: r.mode || "rolling"
  };
}
function recurrenceLabel(rec) {
  const r = normRecurrence(rec);
  if (r.unit === "none") return null;
  const unitWord = r.amount === 1 ? r.unit : `${r.unit}s`;
  return `every ${r.amount} ${unitWord}${r.mode === "fixed" ? " · fixed" : ""}`;
}
function addInterval(dateStr, unit, amount) {
  const d = new Date(dateStr + "T00:00:00");
  if (unit === "day") d.setDate(d.getDate() + amount);else if (unit === "week") d.setDate(d.getDate() + amount * 7);else if (unit === "month") d.setMonth(d.getMonth() + amount);
  return ymdLocal(d);
}
function fmtDate(dateStr) {
  if (!dateStr) return "No date";
  const d = new Date(dateStr + "T00:00:00");
  const today = new Date(adelaideToday() + "T00:00:00");
  const diff = Math.round((d - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff < 0) return `${-diff === 1 ? "1 day" : `${-diff} days`} ago`;
  const base = d.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short"
  });
  if (diff >= 2 && diff <= 14) return `${base} (${diff}d)`;
  return base;
}
/* ensure every room/category actually in use gets a column, and always include a permanent "Unassigned" catch-all */
function withOrphans(sections, tasks, field) {
  const used = new Set(tasks.map(t => t[field]).filter(Boolean));
  const extra = [...used].filter(v => !sections.includes(v) && v !== "Unassigned");
  return [...sections, ...extra, "Unassigned"];
}
const TASKS_COLLECTION = "tasks";
const CONFIG_DOC = db.collection("meta").doc("config");
const PRESENCE_DOC = db.collection("meta").doc("presence");
// love notes: Jade writes them in Settings; John's loading screen shows a random one (never the same twice in a row).
// A copy is cached on the device so the note can show immediately, before sign-in finishes.
const LOVE_DOC = db.collection("meta").doc("loveNotes");
const LOVE_CACHE_KEY = "lifelist-love-notes";
const LOVE_LAST_KEY = "lifelist-love-last";
const LOVE_MIN_MS = 4000;
const loadLoveCache = () => {
  try {
    const v = JSON.parse(localStorage.getItem(LOVE_CACHE_KEY));
    return Array.isArray(v) ? v.filter(x => typeof x === "string" && x.trim()) : [];
  } catch (e) {
    return [];
  }
};
const pickLoveNote = texts => {
  if (!texts.length) return null;
  let last = null;
  try {
    last = localStorage.getItem(LOVE_LAST_KEY);
  } catch (e) {}
  const pool = texts.length > 1 ? texts.filter(x => x !== last) : texts;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  try {
    localStorage.setItem(LOVE_LAST_KEY, pick);
  } catch (e) {}
  return pick;
};
function LoveLoading({
  note,
  text
}) {
  return /*#__PURE__*/<div style={{
    ...centerMsg,
    flexDirection: "column",
    gap: 22,
    padding: "0 32px",
    textAlign: "center"
  }}>{note && /*#__PURE__*/<div style={{
      fontFamily: "Fraunces, serif",
      fontStyle: "italic",
      fontSize: 22,
      lineHeight: 1.4,
      color: C.ink,
      maxWidth: 300
    }}>{note}<div style={{
        fontStyle: "normal",
        fontSize: 14,
        marginTop: 10,
        color: C.inkSoft
      }}>- Jade</div></div>}<div style={{
      fontSize: note ? 11 : 14,
      color: C.inkSoft
    }}>{text}</div></div>;
}
const TODAY_COLLECTION = "today";
const HOUSEHOLD_EMAIL = "access@household-ledger.local";
function sanitizeList(arr, fallback) {
  const clean = [...new Set((arr || []).map(s => String(s).trim()).filter(Boolean))];
  return clean.length ? clean : fallback;
}
function App() {
  const [authReady, setAuthReady] = useState(null);
  // realMe = whoever actually opened the app (from their bookmarked ?user= link). viewAs lets either of you flip the whole
  // app to the other person's view; it always starts as null (= your own view) on every load. `me` is the person being
  // viewed and is what everything displays and records as; only the "while you were away" check uses realMe.
  const [realMe, setRealMe] = useState(null);
  const [viewAs, setViewAs] = useState(null);
  const me = viewAs || realMe;
  const [config, setConfig] = useState({
    rooms: DEFAULT_ROOMS,
    sharedCategories: DEFAULT_CATEGORIES,
    personalCategories: {
      jade: DEFAULT_CATEGORIES,
      john: DEFAULT_CATEGORIES
    }
  });
  const [view, setView] = useState("grid");
  const [showNeedsDetails, setShowNeedsDetails] = useState(false);
  const [lastUndo, setLastUndo] = useState(null); // { label, fn } | null — only ever the most recent action
  const [searchQuery, setSearchQuery] = useState("");
  const setUndo = (label, fn) => setLastUndo({
    label,
    fn
  });
  const handleUndo = () => {
    if (lastUndo) {
      lastUndo.fn();
      setLastUndo(null);
    }
  };
  const [filter, setFilter] = useState("all");
  const [choreFilter, setChoreFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  // which list is open inside the All tasks tab: null (the landing), "household", "personalTasks", "shared" or "personal"
  const [queueSection, setQueueSection] = useState(null);
  const goView = v => {
    if (v === "queue") setQueueSection(null); // tapping the tab always lands on the three buttons
    setView(v);
  };
  const [highlightTaskId, setHighlightTaskId] = useState(null);
  useEffect(() => {
    if (!highlightTaskId) return;
    const t = setTimeout(() => setHighlightTaskId(null), 4000);
    return () => clearTimeout(t);
  }, [highlightTaskId]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  // John's loading screen shows one of Jade's love notes and stays up for at least 4 seconds
  const [loveTexts, setLoveTexts] = useState(loadLoveCache);
  const [loveNote, setLoveNote] = useState(() => new URLSearchParams(window.location.search).get("user") === "john" ? pickLoveNote(loadLoveCache()) : null);
  const [loveHoldDone, setLoveHoldDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLoveHoldDone(true), LOVE_MIN_MS);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (authReady !== true) return;
    return LOVE_DOC.onSnapshot(doc => {
      const d = doc.data() || {};
      const texts = (d.notes || []).map(n => n && n.text).filter(x => typeof x === "string" && x.trim());
      setLoveTexts(texts);
      try {
        localStorage.setItem(LOVE_CACHE_KEY, JSON.stringify(texts));
      } catch (e) {}
      // first time on this device: no cached note yet, so pick one as soon as they arrive
      setLoveNote(cur => cur || (new URLSearchParams(window.location.search).get("user") === "john" ? pickLoveNote(texts) : null));
    }, err => console.error("love notes sync error:", err));
  }, [authReady]);
  const [convertNote, setConvertNote] = useState(null); // plan note being turned into a real task
  const [pickerFor, setPickerFor] = useState(null);
  const [activitySummary, setActivitySummary] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const activityCheckedRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const u = params.get("user");
    if (u && PEOPLE[u]) setRealMe(u);
  }, []);
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(user => {
      if (user && user.email === HOUSEHOLD_EMAIL) setAuthReady(true);else if (user) {
        auth.signOut();
        setAuthReady(false);
      } else setAuthReady(false);
    });
    return unsub;
  }, []);
  // Two scoped queries instead of one unbounded one: active/recurring tasks are always small and cheap, but
  // completed one-off tasks accumulate forever with no pruning — capping that fetch keeps load times flat
  // no matter how many years of history pile up, without deleting anything.
  const [activeTasksMap, setActiveTasksMap] = useState({});
  const [recentCompletedMap, setRecentCompletedMap] = useState({});
  // `tasks` stays null until BOTH queries have answered at least once — otherwise anything keyed off "tasks is
  // ready" (like the activity summary) runs against an empty list on slower connections like phones.
  const [activeLoaded, setActiveLoaded] = useState(false);
  const [completedLoaded, setCompletedLoaded] = useState(false);
  useEffect(() => {
    if (authReady !== true) return;
    const unsub = db.collection(TASKS_COLLECTION).where("completed", "==", false).onSnapshot(snap => {
      const m = {};
      snap.docs.forEach(d => { m[d.id] = { id: d.id, ...d.data() }; });
      setActiveTasksMap(m);
      setActiveLoaded(true);
    }, err => { console.error("sync error (active)", err); setActiveTasksMap({}); setActiveLoaded(true); });
    return unsub;
  }, [authReady]);
  useEffect(() => {
    if (authReady !== true) return;
    const unsub = db.collection(TASKS_COLLECTION).where("completed", "==", true).orderBy("lastCompletedAt", "desc").limit(150).onSnapshot(snap => {
      const m = {};
      snap.docs.forEach(d => { m[d.id] = { id: d.id, ...d.data() }; });
      setRecentCompletedMap(m);
      setCompletedLoaded(true);
    }, err => { console.error("sync error (completed) — if this is an index error, Firestore's console link will create it in one click", err); setRecentCompletedMap({}); setCompletedLoaded(true); });
    return unsub;
  }, [authReady]);
  const tasks = useMemo(() => {
    if (authReady !== true || !activeLoaded || !completedLoaded) return null;
    return [...Object.values(activeTasksMap), ...Object.values(recentCompletedMap)];
  }, [activeTasksMap, recentCompletedMap, authReady, activeLoaded, completedLoaded]);
  const tasksRef = useRef(null);
  tasksRef.current = tasks;
  // "While you were away" check. Runs once when tasks first finish loading, and again whenever the app comes back
  // after being away 30+ minutes (installed phone apps usually resume from the background rather than reloading).
  // The moment the app is hidden we stamp "last seen" so the next check compares from when you actually left.
  const runActivityCheck = useCallback(() => {
    const list = tasksRef.current;
    if (!realMe || list === null) return;
    PRESENCE_DOC.get().then(snap => {
      const data = snap.data() || {};
      const lastVisit = data[realMe];
      const now = Date.now();
      if (lastVisit) {
        // only shared tasks — the other person's personal tasks should never surface here
        const shared = list.filter(t => t.scope === "shared");
        const added = shared.filter(t => t.createdBy && t.createdBy !== realMe && t.createdAt && t.createdAt > lastVisit);
        const completed = shared.filter(t => t.lastCompletedBy && t.lastCompletedBy !== realMe && t.lastCompletedAt && t.lastCompletedAt > lastVisit);
        const notesChanged = shared.filter(t => t.notesUpdatedBy && t.notesUpdatedBy !== realMe && t.notesUpdatedAt && t.notesUpdatedAt > lastVisit);
        if (added.length || completed.length || notesChanged.length) {
          setActivitySummary({ added, completed, notesChanged });
        }
      }
      PRESENCE_DOC.set({ [realMe]: now }, { merge: true }).catch(console.error);
    }).catch(console.error);
  }, [realMe]);
  useEffect(() => {
    if (activityCheckedRef.current) return;
    if (!realMe || tasks === null) return;
    activityCheckedRef.current = true;
    runActivityCheck();
  }, [realMe, tasks, runActivityCheck]);
  useEffect(() => {
    if (!realMe) return;
    let hiddenAt = null;
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        if (activityCheckedRef.current) PRESENCE_DOC.set({ [realMe]: hiddenAt }, { merge: true }).catch(() => {});
      } else if (hiddenAt && Date.now() - hiddenAt > 30 * 60 * 1000) {
        hiddenAt = null;
        // give the live listeners a moment to catch up after waking before comparing
        setTimeout(runActivityCheck, 3000);
      } else {
        hiddenAt = null;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [realMe, runActivityCheck]);
  const [configError, setConfigError] = useState(false);
  useEffect(() => {
    if (authReady !== true) return;
    const unsub = CONFIG_DOC.onSnapshot(doc => {
      setConfigError(false);
      const d = doc.data() || {};
      // fold in anything from the brief unified-categories period so nothing already created gets lost
      const unifiedExtras = sanitizeList(d.categories, []);
      setConfig({
        rooms: sanitizeList(d.rooms, DEFAULT_ROOMS),
        sharedCategories: sanitizeList([...(d.sharedCategories || []), ...unifiedExtras], DEFAULT_CATEGORIES),
        personalCategories: {
          jade: sanitizeList([...(d.personalCategories && d.personalCategories.jade || []), ...unifiedExtras], DEFAULT_CATEGORIES),
          john: sanitizeList([...(d.personalCategories && d.personalCategories.john || []), ...unifiedExtras], DEFAULT_CATEGORIES)
        }
      });
    }, err => {
      console.error("config sync error — likely a Firestore rules issue on /meta/config:", err);
      setConfigError(true);
    });
    return unsub;
  }, [authReady]);
  const addRoom = name => CONFIG_DOC.set({
    rooms: firebase.firestore.FieldValue.arrayUnion(name)
  }, {
    merge: true
  }).catch(console.error);
  const addCategory = (scope, owner, name) => {
    if (scope === "shared") CONFIG_DOC.set({
      sharedCategories: firebase.firestore.FieldValue.arrayUnion(name)
    }, {
      merge: true
    }).catch(console.error);else CONFIG_DOC.set({
      [`personalCategories.${owner}`]: firebase.firestore.FieldValue.arrayUnion(name)
    }, {
      merge: true
    }).catch(console.error);
  };
  const deleteRoom = name => {
    const prevRooms = config.rooms;
    const affectedTasks = (tasks || []).filter(t => t.room === name).map(t => ({
      ...t
    }));
    setUndo("Delete room", () => {
      CONFIG_DOC.update({
        rooms: prevRooms
      }).catch(console.error);
      affectedTasks.forEach(t => db.collection(TASKS_COLLECTION).doc(t.id).set(t).catch(console.error));
    });
    const next = config.rooms.filter(r => r !== name);
    CONFIG_DOC.update({
      rooms: next
    }).catch(e => {
      console.error("delete room failed", e);
      window.alert("Delete failed: " + e.message);
    });
    affectedTasks.forEach(t => db.collection(TASKS_COLLECTION).doc(t.id).update({
      room: null
    }).catch(console.error));
  };
  const deleteCategory = (scope, owner, name) => {
    if (scope === "shared") {
      const prevList = config.sharedCategories;
      const affectedTasks = (tasks || []).filter(t => t.scope === "shared" && t.category === name).map(t => ({
        ...t
      }));
      setUndo("Delete category", () => {
        CONFIG_DOC.update({
          sharedCategories: prevList
        }).catch(console.error);
        affectedTasks.forEach(t => db.collection(TASKS_COLLECTION).doc(t.id).set(t).catch(console.error));
      });
      const next = prevList.filter(c => c !== name);
      CONFIG_DOC.update({
        sharedCategories: next
      }).catch(e => {
        console.error("delete category failed", e);
        window.alert("Delete failed: " + e.message);
      });
      affectedTasks.forEach(t => db.collection(TASKS_COLLECTION).doc(t.id).update({
        category: null
      }).catch(console.error));
    } else {
      const prevList = config.personalCategories[owner] || [];
      const affectedTasks = (tasks || []).filter(t => t.scope === "personal" && t.owner === owner && t.category === name).map(t => ({
        ...t
      }));
      setUndo("Delete category", () => {
        CONFIG_DOC.update({
          [`personalCategories.${owner}`]: prevList
        }).catch(console.error);
        affectedTasks.forEach(t => db.collection(TASKS_COLLECTION).doc(t.id).set(t).catch(console.error));
      });
      const next = prevList.filter(c => c !== name);
      CONFIG_DOC.update({
        [`personalCategories.${owner}`]: next
      }).catch(e => {
        console.error("delete category failed", e);
        window.alert("Delete failed: " + e.message);
      });
      affectedTasks.forEach(t => db.collection(TASKS_COLLECTION).doc(t.id).update({
        category: null
      }).catch(console.error));
    }
  };
  const reorderRoomsFull = newArr => CONFIG_DOC.update({
    rooms: newArr
  }).catch(console.error);
  const reorderCategoriesFull = (scope, owner, newArr) => {
    if (scope === "shared") CONFIG_DOC.update({
      sharedCategories: newArr
    }).catch(console.error);else CONFIG_DOC.update({
      [`personalCategories.${owner}`]: newArr
    }).catch(console.error);
  };

  /* Today's plan — private per person: sundry one-off items + references to real tasks, one combined
     reorderable list. Lives in its own doc per person so it never becomes visible to the other partner. */
  const [todayItems, setTodayItems] = useState([]);
  useEffect(() => {
    if (authReady !== true || !me) return;
    const unsub = db.collection(TODAY_COLLECTION).doc(me).onSnapshot(doc => setTodayItems(doc.data() && doc.data().items || []), err => console.error("today sync error — check Firestore rules cover /today/{docId}:", err));
    return unsub;
  }, [authReady, me]);
  const saveTodayRaw = items => db.collection(TODAY_COLLECTION).doc(me).set({
    items
  }, {
    merge: true
  }).catch(console.error);
  const saveToday = (label, items) => {
    const prev = todayItems;
    setUndo(label, () => saveTodayRaw(prev));
    saveTodayRaw(items);
  };
  const todayKey = it => it.type + it.id + (it.subtaskId || "");
  const todayBucket = it => it.bucket === "later" ? "later" : "now";
  // Quick add from the plan: a private one-off note on this person's plan (not a real task). Matching real tasks are
  // suggested in the UI so people tap those instead of re-typing; real tasks come from the + button.
  const addSundry = title => saveToday("Add to the plan", [...todayItems, {
    type: "sundry",
    id: uid(),
    title: title.trim(),
    completed: false,
    bucket: "now"
  }]);
  // ticking off a quick-add note just removes it (it's a private reminder, not a record)
  const toggleSundry = id => saveToday("Tick off note", todayItems.filter(it => it.id !== id));
  const deleteSundry = id => saveToday("Delete sundry", todayItems.filter(it => it.id !== id));
  const addTaskToToday = (taskId, subtaskId) => {
    if (todayItems.some(it => it.type === "task" && it.id === taskId && (it.subtaskId || null) === (subtaskId || null))) return;
    saveToday("Add to the plan", [...todayItems, {
      type: "task",
      id: taskId,
      subtaskId: subtaskId || null,
      bucket: "now"
    }]);
  };
  const removeTaskFromToday = (taskId, subtaskId) => saveToday("Remove from the plan", todayItems.filter(it => !(it.type === "task" && it.id === taskId && (it.subtaskId || null) === (subtaskId || null))));
  // reorder only moves within the same bucket (Today vs Later), skipping over items from the other bucket
  const reorderToday = (item, dir) => {
    const key = todayKey(item);
    const idx = todayItems.findIndex(it => todayKey(it) === key);
    if (idx < 0) return;
    const b = todayBucket(todayItems[idx]);
    let j = idx;
    do {
      j += dir;
    } while (j >= 0 && j < todayItems.length && todayBucket(todayItems[j]) !== b);
    if (j < 0 || j >= todayItems.length) return;
    const arr = todayItems.slice();
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    saveToday("Reorder today", arr);
  };
  // drag-and-drop finalize for one bucket's subset — the other bucket's items pass through untouched
  const reorderTodayBucketFull = (bucket, newSubsetOrder) => {
    const others = todayItems.filter(it => todayBucket(it) !== bucket);
    saveToday("Reorder today", bucket === "later" ? [...others, ...newSubsetOrder] : [...newSubsetOrder, ...others]);
  };
  const setTodayBucket = (item, bucket) => {
    const key = todayKey(item);
    saveToday("Move item", todayItems.map(it => todayKey(it) === key ? {
      ...it,
      bucket
    } : it));
  };
  // a local "done today" checkmark, independent of the underlying task's real completion state — this is what
  // makes the Today's-plan checkbox behave sensibly even for recurring chores, which reset completed:false
  // immediately as part of advancing their schedule and would otherwise never visibly show as checked here.
  const toggleTodayTaskDone = item => {
    const key = todayKey(item);
    saveToday("Mark done", todayItems.map(it => todayKey(it) === key ? {
      ...it,
      completedToday: !it.completedToday
    } : it));
  };
  const resetToday = () => saveToday("Reset today", []);
  const captureUndo = (label, taskIds) => {
    const snapshots = taskIds.map(id => tasks.find(t => t.id === id)).filter(Boolean).map(t => ({
      ...t
    }));
    if (!snapshots.length) return;
    setUndo(label, () => {
      snapshots.forEach(snap => db.collection(TASKS_COLLECTION).doc(snap.id).set(snap).catch(console.error));
    });
  };
  const upsertTask = task => {
    const {
      id,
      ...data
    } = task;
    const prev = tasks.find(t => t.id === id);
    const notesChanged = prev ? (data.notes || "") !== (prev.notes || "") : !!(data.notes && data.notes.trim());
    setUndo(prev ? "Edit task" : "New task", () => {
      if (prev) db.collection(TASKS_COLLECTION).doc(id).set(prev).catch(console.error);else db.collection(TASKS_COLLECTION).doc(id).delete().catch(console.error);
    });
    db.collection(TASKS_COLLECTION).doc(id).set({
      ...data,
      updatedAt: Date.now(),
      ...(notesChanged ? { notesUpdatedAt: Date.now(), notesUpdatedBy: me } : {})
    }).catch(e => console.error("save failed", e));
  };
  const deleteTask = id => {
    captureUndo("Delete task", [id]);
    db.collection(TASKS_COLLECTION).doc(id).delete().catch(e => console.error(e));
  };
  // export/import always work against a fresh, full fetch of the tasks collection — not the in-memory `tasks`
  // state, which is deliberately scoped (active + recent completions only) to keep normal app loads fast.
  const exportData = async () => {
    try {
      const snap = await db.collection(TASKS_COLLECTION).get();
      const allTasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const payload = { exportedAt: new Date().toISOString(), tasks: allTasks, config };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `household-backup-${adelaideToday()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("export failed", e);
      window.alert("Export failed: " + e.message);
    }
  };
  const importData = async file => {
    let payload;
    try {
      payload = JSON.parse(await file.text());
    } catch (e) {
      window.alert("That file isn't valid JSON.");
      return;
    }
    if (!Array.isArray(payload.tasks)) {
      window.alert("That file doesn't look like a valid backup.");
      return;
    }
    if (!window.confirm(`This replaces ALL current tasks and sections with the ${payload.tasks.length} tasks in this backup. This can't be undone. Continue?`)) return;
    try {
      const existingSnap = await db.collection(TASKS_COLLECTION).get();
      const ops = [
        ...existingSnap.docs.map(d => ({ type: "delete", ref: d.ref })),
        ...payload.tasks.map(t => ({ type: "set", ref: db.collection(TASKS_COLLECTION).doc(t.id), data: t }))
      ];
      for (let i = 0; i < ops.length; i += 450) {
        const batch = db.batch();
        ops.slice(i, i + 450).forEach(op => {
          if (op.type === "delete") batch.delete(op.ref);
          else {
            const { id, ...data } = op.data;
            batch.set(op.ref, data);
          }
        });
        await batch.commit();
      }
      if (payload.config) await CONFIG_DOC.set(payload.config);
      window.alert("Import complete.");
    } catch (e) {
      console.error("import failed", e);
      window.alert("Import failed: " + e.message);
    }
  };
  const toggleComplete = task => {
    captureUndo("Toggle complete", [task.id]);
    const ref = db.collection(TASKS_COLLECTION).doc(task.id);
    const rec = normRecurrence(task.recurrence);
    if (!task.completed && rec.unit !== "none" && task.dueDate) {
      const todayStr = adelaideToday();
      const base = rec.mode === "fixed" ? task.dueDate : todayStr;
      const nextDue = addInterval(base, rec.unit, rec.amount);
      ref.update({
        dueDate: nextDue,
        completed: false,
        completedAt: null,
        lastCompletedAt: Date.now(),
        lastCompletedBy: me
      }).catch(console.error);
    } else {
      const nowCompleting = !task.completed;
      ref.update({
        completed: nowCompleting,
        completedAt: nowCompleting ? Date.now() : null,
        lastCompletedAt: nowCompleting ? Date.now() : null,
        lastCompletedBy: nowCompleting ? me : null
      }).catch(console.error);
    }
  };
  const updateActions = (taskId, actions) => db.collection(TASKS_COLLECTION).doc(taskId).update({
    actions
  }).catch(console.error);
  const toggleAction = (taskId, actionId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    captureUndo("Toggle subtask", [taskId]);
    updateActions(taskId, (task.actions || []).map(a => a.id === actionId ? {
      ...a,
      completed: !a.completed
    } : a));
  };
  const addAction = (taskId, title) => {
    if (!title.trim()) return;
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    captureUndo("Add subtask", [taskId]);
    updateActions(taskId, [...(task.actions || []), {
      id: uid(),
      title: title.trim(),
      completed: false,
      dueDate: null
    }]);
  };
  const deleteAction = (taskId, actionId) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    captureUndo("Delete subtask", [taskId]);
    updateActions(taskId, (task.actions || []).filter(a => a.id !== actionId));
  };
  const reorderAction = (taskId, actionId, dir) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    const idx = (task.actions || []).findIndex(a => a.id === actionId);
    if (idx < 0) return;
    captureUndo("Reorder subtasks", [taskId]);
    updateActions(taskId, moveAction(task.actions || [], idx, dir));
  };
  const setTaskActions = (taskId, actions) => {
    captureUndo("Reorder subtasks", [taskId]);
    updateActions(taskId, actions);
  };
  const setActionDueDate = (taskId, actionId, date) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    captureUndo("Set subtask date", [taskId]);
    updateActions(taskId, (task.actions || []).map(a => a.id === actionId ? {
      ...a,
      dueDate: date || null
    } : a));
  };
  const setTaskDueDate = (taskId, date) => {
    captureUndo("Change due date", [taskId]);
    db.collection(TASKS_COLLECTION).doc(taskId).update({
      dueDate: date
    }).catch(console.error);
  };
  /* "Not today" postponement — hides from the to-do list without touching the real due date, so overdue/stale
     status stays honest. Chores get it on the task itself; project subtasks get it on the specific subtask.
     Keyed per-person: postponing a shared or unassigned task only hides it for the person who postponed it. */
  const setTaskHiddenUntil = (taskId, date) => {
    captureUndo("Postpone", [taskId]);
    db.collection(TASKS_COLLECTION).doc(taskId).update({
      [`hiddenUntil.${me}`]: date
    }).catch(console.error);
  };
  const setActionHiddenUntil = (taskId, actionId, date) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    captureUndo("Postpone", [taskId]);
    updateActions(taskId, (task.actions || []).map(a => a.id === actionId ? {
      ...a,
      hiddenUntil: {
        ...(a.hiddenUntil || {}),
        [me]: date
      }
    } : a));
  };
  /* manual "add to to-do list" — lets a date-less chore or an unpinned project show up in the to-do list
     even though it wouldn't qualify automatically. Independent of pinning/priority and of the plan. */
  const toggleManualTodo = taskId => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;
    captureUndo("To-do list", [taskId]);
    db.collection(TASKS_COLLECTION).doc(taskId).update({
      manualTodo: !task.manualTodo
    }).catch(console.error);
  };

  /* scope-aware: pinning a task only clears the previous occupant of that slot
     if the previous occupant was pinned from the SAME scope (personal vs shared) — personal and
     shared pins for the same person+bucket are independent of each other. */
  const setBucket = (taskId, person, bucket, scope) => {
    const affected = [taskId, ...tasks.filter(t => t.id !== taskId && t.scope === scope && t.gridBucket && t.gridBucket[person] === bucket).map(t => t.id)];
    captureUndo("Pin priority", affected);
    db.collection(TASKS_COLLECTION).doc(taskId).update({
      [`gridBucket.${person}`]: bucket
    }).catch(console.error);
    tasks.forEach(t => {
      if (t.id !== taskId && t.scope === scope && t.gridBucket && t.gridBucket[person] === bucket) {
        db.collection(TASKS_COLLECTION).doc(t.id).update({
          [`gridBucket.${person}`]: firebase.firestore.FieldValue.delete()
        }).catch(console.error);
      }
    });
  };
  const clearBucket = (taskId, person) => {
    captureUndo("Unpin priority", [taskId]);
    db.collection(TASKS_COLLECTION).doc(taskId).update({
      [`gridBucket.${person}`]: firebase.firestore.FieldValue.delete()
    }).catch(console.error);
  };
  const visibleTasks = useMemo(() => (tasks || []).filter(t => t.scope === "shared" || t.owner === me), [tasks, me]);
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return visibleTasks.filter(t => t.title.toLowerCase().includes(q)).slice(0, 8);
  }, [searchQuery, visibleTasks]);
  const needsDetailsTasks = useMemo(() => (tasks || []).filter(t => t.needsDetails && t.createdBy === me), [tasks, me]);
  if (authReady === null) return /*#__PURE__*/<Shell><LoveLoading note={loveNote} text="Loading…" /></Shell>;
  if (authReady === false) return /*#__PURE__*/<Shell><PinGate /></Shell>;
  if (!me) {
    return /*#__PURE__*/<Shell><div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: 18,
        padding: 24
      }}><div style={{
          fontFamily: "Fraunces, serif",
          fontSize: 26,
          color: C.ink,
          textAlign: "center"
        }}>Who's checking in?</div><div style={{
          fontSize: 13,
          color: C.inkSoft,
          textAlign: "center",
          maxWidth: 260
        }}>Bookmark this page with <code>?user=jade</code> or <code>?user=john</code> on the end of the URL to always land on your view.</div><div style={{
          display: "flex",
          gap: 12
        }}>{Object.entries(PEOPLE).map(([key, label]) => /*#__PURE__*/<button key={key} onClick={() => setRealMe(key)} style={btnStyle(PERSON_COLOR[key])}>{label}</button>)}</div></div></Shell>;
  }
  if (tasks === null || loveNote && !loveHoldDone) return /*#__PURE__*/<Shell><LoveLoading note={loveNote} text="Loading the list…" /></Shell>;
  return /*#__PURE__*/<Shell><Header me={me} realMe={realMe} onViewAs={k => setViewAs(k === realMe ? null : k)} view={view} setView={goView} needsDetailsCount={needsDetailsTasks.length} onOpenNeedsDetails={() => setShowNeedsDetails(true)} undoLabel={lastUndo ? lastUndo.label : null} onUndo={handleUndo} searchQuery={searchQuery} setSearchQuery={setSearchQuery} searchResults={searchResults} onSelectSearchResult={t => {
      setSearchQuery("");
      setView("queue");
      setQueueSection(sectionForTask(t));
      setChoreFilter("all");
      setProjectFilter("all");
      setHighlightTaskId(t.id);
    }} onOpenSettings={() => setShowSettings(true)} />{configError && /*#__PURE__*/<div style={{
      background: C.plum,
      color: C.white,
      fontSize: 11,
      padding: "6px 16px",
      textAlign: "center"
    }}>Can't sync sections (rooms/categories) — check your Firestore rules cover /meta/config too.</div>}{view === "grid" ? /*#__PURE__*/<PriorityGrid tasks={tasks} me={me} viewingPerson={me} onOpenPicker={setPickerFor} onClearBucket={clearBucket} onToggleAction={toggleAction} onEditTask={t => {
      setEditing(t);
      setShowForm(true);
    }} /> : view === "todo" ? /*#__PURE__*/<ToDoList tasks={visibleTasks} onToggle={toggleComplete} onEdit={t => {
      setEditing(t);
      setShowForm(true);
    }} onDelete={deleteTask} onToggleAction={toggleAction} onAddAction={addAction} onDeleteAction={deleteAction} onReorderAction={reorderAction} onSetTaskActions={setTaskActions} onSetActionDueDate={setActionDueDate} onSetTaskDueDate={setTaskDueDate} onSetTaskHiddenUntil={setTaskHiddenUntil} onSetActionHiddenUntil={setActionHiddenUntil} onToggleManualTodo={toggleManualTodo} me={me} todayItems={todayItems} onAddSundry={addSundry} onToggleSundry={toggleSundry} onDeleteSundry={deleteSundry} onAddTaskToToday={addTaskToToday} onRemoveTaskFromToday={removeTaskFromToday} onReorderToday={reorderToday} onReorderTodayBucketFull={reorderTodayBucketFull} onResetToday={resetToday} onSetTodayBucket={setTodayBucket} onToggleTodayTaskDone={toggleTodayTaskDone} onConvertNote={n => {
      setEditing(null);
      setConvertNote(n);
      setShowForm(true);
    }} /> : /*#__PURE__*/<QueueView tasks={visibleTasks} me={me} filter={filter} setFilter={setFilter} choreFilter={choreFilter} setChoreFilter={setChoreFilter} projectFilter={projectFilter} setProjectFilter={setProjectFilter} section={queueSection} setSection={setQueueSection} highlightTaskId={highlightTaskId} config={config} onAddRoom={addRoom} onAddCategory={addCategory} onDeleteRoom={deleteRoom} onDeleteCategory={deleteCategory} onReorderRoomsFull={reorderRoomsFull} onReorderCategoriesFull={reorderCategoriesFull} onToggle={toggleComplete} onEdit={t => {
      setEditing(t);
      setShowForm(true);
    }} onDelete={deleteTask} onToggleAction={toggleAction} onAddAction={addAction} onDeleteAction={deleteAction} onReorderAction={reorderAction} onSetTaskActions={setTaskActions} onSetActionDueDate={setActionDueDate} onToggleManualTodo={toggleManualTodo} />}<button onClick={() => {
      setEditing(null);
      setShowForm(true);
    }} style={{
      position: "absolute",
      right: 18,
      bottom: 22,
      width: 52,
      height: 52,
      borderRadius: "50%",
      background: C.ink,
      color: C.white,
      border: "none",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      boxShadow: "0 6px 16px rgba(43,42,40,0.28)",
      cursor: "pointer",
      fontSize: 24
    }} aria-label="Add task">+</button>{showForm && /*#__PURE__*/<TaskForm me={me} initial={editing} prefillTitle={!editing && convertNote ? convertNote.title : ""} config={config} onAddRoom={addRoom} onAddCategory={addCategory} onClose={() => {
      setShowForm(false);
      setConvertNote(null);
    }} onSave={t => {
      upsertTask(t);
      if (convertNote && !editing) {
        // swap the note for the real task in the same spot on the plan
        saveToday("Turn note into task", todayItems.map(it => it.type === "sundry" && it.id === convertNote.id ? {
          type: "task",
          id: t.id,
          subtaskId: null,
          bucket: it.bucket || "now"
        } : it));
      }
      setConvertNote(null);
      setShowForm(false);
    }} onDelete={id => {
      deleteTask(id);
      setShowForm(false);
    }} />}{showNeedsDetails && /*#__PURE__*/<NeedsDetailsList tasks={needsDetailsTasks} onClose={() => setShowNeedsDetails(false)} onPick={t => {
      setEditing(t);
      setShowForm(true);
      setShowNeedsDetails(false);
    }} />}{pickerFor && /*#__PURE__*/<BucketPicker tasks={tasks.filter(t => t.listType === "project" && !t.completed && (pickerFor.scope === "shared" ? t.scope === "shared" && (t.assignee === pickerFor.person || !t.assignee) : t.scope === "personal" && t.owner === pickerFor.person) && (!t.priorityBucket || t.priorityBucket === pickerFor.bucket))} onPick={taskId => {
      setBucket(taskId, pickerFor.person, pickerFor.bucket, pickerFor.scope);
      setPickerFor(null);
    }} onClose={() => setPickerFor(null)} />}{activitySummary && /*#__PURE__*/<ActivitySummary summary={activitySummary} onClose={() => setActivitySummary(null)} />}{showSettings && /*#__PURE__*/<SettingsPanel loveTexts={loveTexts} onSaveLoveNotes={texts => LOVE_DOC.set({
      notes: texts.map(text => ({
        id: uid(),
        text
      }))
    }).catch(console.error)} onClose={() => setShowSettings(false)} onExport={exportData} onImport={importData} />}</Shell>;
}
const centerMsg = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  color: "#5C574C",
  fontFamily: "Fraunces, serif"
};

/* ---------- PIN gate ---------- */
function PinGate() {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = () => {
    if (!pin.trim() || busy) return;
    setBusy(true);
    setError("");
    auth.signInWithEmailAndPassword(HOUSEHOLD_EMAIL, pin).catch(() => setError("Wrong PIN — try again.")).finally(() => setBusy(false));
  };
  return /*#__PURE__*/<div style={{
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    gap: 14,
    padding: 24
  }}><div style={{
      fontFamily: "Fraunces, serif",
      fontSize: 24,
      color: C.ink,
      textAlign: "center"
    }}>Enter the household PIN</div><input type="password" inputMode="numeric" autoFocus={true} value={pin} onChange={e => setPin(e.target.value)} onKeyDown={e => {
      if (e.key === "Enter") submit();
    }} style={{
      ...inputStyle,
      width: 200,
      textAlign: "center",
      letterSpacing: 4,
      fontSize: 18
    }} />{error && /*#__PURE__*/<div style={{
      color: C.plum,
      fontSize: 12.5
    }}>{error}</div>}<button onClick={submit} disabled={busy || !pin.trim()} style={{
      ...btnStyle(C.ink),
      opacity: busy || !pin.trim() ? 0.5 : 1
    }}>{busy ? "Checking…" : "Unlock"}</button></div>;
}

/* ---------- shell ---------- */
function Shell({
  children
}) {
  return /*#__PURE__*/<div className="app-shell-height" style={{
    position: "relative",
    width: "100%",
    maxWidth: 480,
    margin: "0 auto",
    background: C.parchment,
    fontFamily: "Inter, sans-serif",
    overflow: "hidden",
    paddingBottom: "env(safe-area-inset-bottom)",
    boxSizing: "border-box"
  }}>{children}</div>;
}
function btnStyle(bg) {
  return {
    padding: "12px 22px",
    borderRadius: 10,
    border: "none",
    background: bg,
    color: C.white,
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer"
  };
}
function Header({
  me,
  realMe,
  onViewAs,
  view,
  setView,
  needsDetailsCount,
  onOpenNeedsDetails,
  undoLabel,
  onUndo,
  searchQuery,
  setSearchQuery,
  searchResults,
  onSelectSearchResult,
  onOpenSettings
}) {
  return /*#__PURE__*/<div style={{
    padding: "18px 18px 10px",
    borderBottom: `1px solid ${C.rule}`,
    // a coloured strip along the bottom edge shows at a glance when you're looking at the other person's view
    boxShadow: me !== realMe ? `inset 0 -3px 0 ${PERSON_COLOR[me]}` : "none",
    position: "relative"
  }}><div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "baseline"
    }}><div style={{
        fontFamily: "Fraunces, serif",
        fontSize: 22,
        fontWeight: 600,
        color: C.ink
      }}>Our Life List</div><div style={{
        display: "flex",
        alignItems: "center",
        gap: 8
      }}>{needsDetailsCount > 0 && /*#__PURE__*/<button onClick={onOpenNeedsDetails} style={{
          border: "none",
          background: C.mustard,
          color: C.white,
          borderRadius: 20,
          padding: "3px 9px",
          fontSize: 10.5,
          fontWeight: 700,
          cursor: "pointer"
        }}>{needsDetailsCount} need details</button>}<button onClick={onOpenSettings} aria-label="Settings" style={{
          border: "none",
          background: "none",
          color: C.inkSoft,
          fontSize: 15,
          cursor: "pointer",
          padding: "2px 4px"
        }}>⚙</button><div role="group" aria-label="View as" style={{
          display: "flex",
          border: `1px solid ${C.rule}`,
          borderRadius: 20,
          overflow: "hidden"
        }}>{Object.entries(PEOPLE).map(([k, label]) => {
          const active = me === k;
          return /*#__PURE__*/<button key={k} onClick={() => onViewAs(k)} aria-pressed={active} style={{
            border: "none",
            padding: "3px 10px",
            fontSize: 11,
            fontWeight: active ? 700 : 500,
            cursor: "pointer",
            background: active ? PERSON_COLOR[k] : C.white,
            color: active ? C.white : C.inkSoft
          }}>{label}{k === realMe ? " · you" : ""}</button>;
        })}</div></div></div><div style={{
      position: "absolute",
      top: 4,
      right: 8,
      fontSize: 8.5,
      color: C.rule
    }}>{APP_VERSION}</div><div style={{
      display: "flex",
      gap: 8,
      alignItems: "center",
      marginTop: 12
    }}><button onClick={onUndo} disabled={!undoLabel} style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        border: `1px solid ${C.rule}`,
        background: undoLabel ? C.card : "transparent",
        color: undoLabel ? C.inkSoft : C.rule,
        borderRadius: 20,
        padding: "6px 12px",
        fontSize: 11,
        fontWeight: 600,
        cursor: undoLabel ? "pointer" : "default",
        whiteSpace: "nowrap",
        flexShrink: 0
      }}>↺ {undoLabel ? `Undo ${undoLabel}` : "Undo"}</button><input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search tasks…" style={{
        flex: 1,
        minWidth: 0,
        padding: "6px 12px",
        borderRadius: 20,
        border: `1px solid ${C.rule}`,
        background: C.white,
        fontSize: 12,
        color: C.ink,
        outline: "none",
        boxSizing: "border-box"
      }} /></div>{searchQuery.trim() && /*#__PURE__*/<div style={{
      position: "absolute",
      left: 18,
      right: 18,
      top: "100%",
      background: C.white,
      border: `1px solid ${C.rule}`,
      borderRadius: 10,
      marginTop: 4,
      boxShadow: "0 8px 20px rgba(43,42,40,0.18)",
      zIndex: 20,
      maxHeight: 260,
      overflowY: "auto"
    }}>{searchResults.length === 0 && /*#__PURE__*/<div style={{
        padding: "12px",
        fontSize: 12.5,
        color: C.inkSoft,
        textAlign: "center"
      }}>No matches.</div>}{searchResults.map(t => /*#__PURE__*/<button key={t.id} onMouseDown={e => e.preventDefault()} onClick={() => onSelectSearchResult(t)} style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        border: "none",
        borderBottom: `1px solid ${C.rule}`,
        background: "none",
        padding: "10px 12px",
        cursor: "pointer"
      }}><span style={{
          fontSize: 13,
          color: C.ink,
          fontWeight: 600
        }}>{t.title}</span><span style={{
          fontSize: 10.5,
          color: C.inkSoft,
          marginLeft: 6
        }}>{t.listType === "chore" ? "Chore" : "Project"}</span></button>)}</div>}<div style={{
      display: "flex",
      gap: 8,
      marginTop: 14
    }}><TabButton active={view === "todo"} onClick={() => setView("todo")} label="To-do list" /><TabButton active={view === "grid"} onClick={() => setView("grid")} label="Priorities" /><TabButton active={view === "queue"} onClick={() => setView("queue")} label="All tasks" /></div></div>;
}
function TabButton({
  active,
  onClick,
  label
}) {
  return /*#__PURE__*/<button onClick={onClick} style={{
    flex: 1,
    padding: "9px 0",
    borderRadius: 8,
    border: `1px solid ${active ? C.ink : C.rule}`,
    background: active ? C.ink : "transparent",
    color: active ? C.white : C.inkSoft,
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer"
  }}>{label}</button>;
}
function PersonBadge({
  person,
  size = 20
}) {
  if (!person) return /*#__PURE__*/<span style={{
    width: size,
    height: size,
    borderRadius: "50%",
    background: C.rule,
    flexShrink: 0,
    display: "inline-block"
  }} />;
  return /*#__PURE__*/<span style={{
    fontSize: size <= 20 ? 9 : 10,
    fontWeight: 700,
    color: C.white,
    background: PERSON_COLOR[person],
    borderRadius: "50%",
    width: size,
    height: size,
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center"
  }}>{PERSON_CODE[person]}</span>;
}
function FilterChip({
  active,
  onClick,
  label,
  activeColor,
  activeTint
}) {
  const c = activeColor || C.ink;
  const tint = activeTint || C.card;
  return /*#__PURE__*/<button onClick={onClick} style={{
    flex: 1,
    padding: "6px 0",
    borderRadius: 20,
    border: `1.5px solid ${active ? c : C.rule}`,
    background: active ? tint : "transparent",
    color: active ? c : C.inkSoft,
    fontWeight: active ? 700 : 500,
    fontSize: 12,
    cursor: "pointer"
  }}>{label}</button>;
}

/* ---------- priority grid ---------- */
function PriorityGrid({
  tasks,
  me,
  viewingPerson,
  onOpenPicker,
  onClearBucket,
  onToggleAction,
  onEditTask
}) {
  return /*#__PURE__*/<div style={{
    padding: "16px 16px 12px",
    height: "calc(100% - 150px)",
    display: "flex",
    flexDirection: "column"
  }}><div style={{
      fontFamily: "Fraunces, serif",
      fontSize: 20,
      fontWeight: 600,
      color: C.ink,
      marginBottom: 14,
      flexShrink: 0
    }}>{PEOPLE[viewingPerson]}'s priorities</div><div style={{
      display: "grid",
      gridTemplateColumns: "26px repeat(2, 1fr)",
      gap: 6,
      marginBottom: 6,
      flexShrink: 0
    }}><div />{[["personal", "Personal"], ["shared", "Shared"]].map(([scope, label]) => /*#__PURE__*/<div key={scope} style={{
        fontSize: 9.5,
        color: C.inkSoft,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        fontWeight: 700,
        textAlign: "center"
      }}>{label}</div>)}</div><div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      gap: 8,
      minHeight: 0
    }}>{BUCKETS.map(b => /*#__PURE__*/<div key={b.key} style={{
        display: "grid",
        gridTemplateColumns: "26px repeat(2, 1fr)",
        gap: 6,
        flex: 1,
        minHeight: 0
      }}><div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }}><span style={{
            fontSize: 10.5,
            color: C.inkSoft,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.5,
            writingMode: "vertical-rl",
            transform: "rotate(180deg)"
          }}>{b.label}</span></div>{[["personal"], ["shared"]].map(([scope]) => /*#__PURE__*/<GridCell key={scope} bucket={b} scope={scope} person={viewingPerson} tasks={tasks} onOpenPicker={onOpenPicker} onClearBucket={onClearBucket} onToggleAction={onToggleAction} onEditTask={onEditTask} />)}</div>)}</div></div>;
}
function GridCell({
  bucket,
  scope,
  person,
  tasks,
  onOpenPicker,
  onClearBucket,
  onToggleAction,
  onEditTask
}) {
  const pinned = tasks.find(t => t.gridBucket && t.gridBucket[person] === bucket.key && (scope === "shared" ? t.scope === "shared" : t.scope === "personal" && t.owner === person));
  const incomplete = pinned ? (pinned.actions || []).filter(a => !a.completed) : [];
  return /*#__PURE__*/<div style={{
    background: C.card,
    border: `1px solid ${C.rule}`,
    borderRadius: 10,
    padding: 8,
    position: "relative",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden"
  }}>{pinned ? /*#__PURE__*/<div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%"
    }}><button onClick={() => onEditTask(pinned)} style={{
        width: "100%",
        background: C.rule,
        borderRadius: 10,
        padding: "6px 8px",
        minHeight: 46,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "none",
        cursor: "pointer"
      }}><span style={{
          textAlign: "center",
          fontFamily: "Fraunces, serif",
          fontSize: 15,
          color: C.ink,
          fontWeight: 700,
          lineHeight: 1.2,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical"
        }}>{pinned.title}</span></button>{incomplete.length > 0 ? /*#__PURE__*/<div style={{
        marginTop: 5,
        flex: 1,
        overflowY: "auto",
        minHeight: 0
      }}><button onClick={() => onToggleAction(pinned.id, incomplete[0].id)} style={{
          display: "block",
          width: "100%",
          textAlign: "left",
          border: "none",
          background: "none",
          padding: 0,
          cursor: "pointer"
        }}><span style={{
            fontSize: 12,
            color: C.sageDeep,
            fontWeight: 700,
            lineHeight: 1.3
          }}>Next: {incomplete[0].title}</span>{incomplete[0].dueDate && /*#__PURE__*/<span style={{
            fontSize: 9.5,
            color: C.inkSoft
          }}> · {fmtDate(incomplete[0].dueDate)}</span>}</button>{incomplete.slice(1).map(a => /*#__PURE__*/<div key={a.id} onClick={() => onToggleAction(pinned.id, a.id)} style={{
          fontSize: 9,
          color: C.inkSoft,
          opacity: 0.55,
          marginTop: 3,
          cursor: "pointer",
          lineHeight: 1.3
        }}>{a.title}</div>)}</div> : (pinned.actions || []).length > 0 ? /*#__PURE__*/<div style={{
        fontSize: 10,
        color: C.inkSoft,
        marginTop: 4
      }}>All subtasks done</div> : /*#__PURE__*/<div style={{
        flex: 1
      }} />}{pinned.notes && /*#__PURE__*/<div style={{
        fontSize: 9.5,
        color: C.inkSoft,
        fontStyle: "italic",
        marginTop: 4,
        lineHeight: 1.3,
        overflow: "hidden",
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
        flexShrink: 0
      }}>{pinned.notes}</div>}<div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 6,
        flexShrink: 0
      }}><span style={{
          fontSize: 10,
          color: C.inkSoft,
          fontFamily: "IBM Plex Mono, monospace",
          fontWeight: 600
        }}>{fmtDate(pinned.dueDate)}</span><button onClick={() => onClearBucket(pinned.id, person)} style={{
          border: "none",
          background: "none",
          cursor: "pointer",
          color: C.inkSoft,
          padding: 0,
          fontSize: 13
        }}>×</button></div></div> : /*#__PURE__*/<button onClick={() => onOpenPicker({
      person,
      scope,
      bucket: bucket.key
    })} style={{
      width: "100%",
      height: "100%",
      minHeight: 34,
      border: `1px dashed ${C.rule}`,
      borderRadius: 6,
      background: "transparent",
      color: C.inkSoft,
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 13
    }}>📌</button>}</div>;
}
function BucketPicker({
  tasks,
  onPick,
  onClose
}) {
  return /*#__PURE__*/<Overlay title="Pin to this slot" onClose={onClose}><div style={{
      fontSize: 11.5,
      color: C.inkSoft,
      marginBottom: 10
    }}>Showing projects already tagged for this bucket, or untagged ones. Chores don't appear here.</div>{tasks.length === 0 && /*#__PURE__*/<div style={{
      color: C.inkSoft,
      fontSize: 13,
      padding: "8px 0"
    }}>Nothing matches yet. Add or tag a project first.</div>}{tasks.map(t => /*#__PURE__*/<button key={t.id} onClick={() => onPick(t.id)} style={{
      width: "100%",
      textAlign: "left",
      padding: "11px 12px",
      marginBottom: 6,
      borderRadius: 8,
      border: `1px solid ${C.rule}`,
      background: C.white,
      cursor: "pointer",
      fontSize: 13.5,
      color: C.ink
    }}>{t.title}<div style={{
        fontSize: 10.5,
        color: C.inkSoft,
        marginTop: 2,
        fontFamily: "IBM Plex Mono, monospace"
      }}>{fmtDate(t.dueDate)}</div></button>)}</Overlay>;
}
function NeedsDetailsList({
  tasks,
  onPick,
  onClose
}) {
  return /*#__PURE__*/<Overlay title="Finish these off" onClose={onClose}><div style={{
      fontSize: 11.5,
      color: C.inkSoft,
      marginBottom: 10
    }}>Tasks you added without full details. Tap one to fill it in properly.</div>{tasks.map(t => /*#__PURE__*/<button key={t.id} onClick={() => onPick(t)} style={{
      width: "100%",
      textAlign: "left",
      padding: "11px 12px",
      marginBottom: 6,
      borderRadius: 8,
      border: `1px solid ${C.rule}`,
      background: C.white,
      cursor: "pointer",
      fontSize: 13.5,
      color: C.ink
    }}>{t.title}<div style={{
        fontSize: 10.5,
        color: C.inkSoft,
        marginTop: 2
      }}>{t.listType === "chore" ? "Chore" : "Project"}</div></button>)}</Overlay>;
}

/* ---------- while-you-were-away summary: everything the OTHER person did on shared tasks since your last visit ---------- */
function ActivitySummary({ summary, onClose }) {
  const { added, completed, notesChanged } = summary;
  const Section = ({ title, items }) => items.length === 0 ? null : /*#__PURE__*/<div style={{ marginBottom: 16 }}>
    <div style={{ fontSize: 11, color: C.inkSoft, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 6 }}>{title}</div>
    {items.map(t => /*#__PURE__*/<div key={t.id} style={{ fontSize: 13.5, color: C.ink, padding: "7px 0", borderBottom: `1px solid ${C.rule}` }}>{t.title}</div>)}
  </div>;
  return /*#__PURE__*/<Overlay title="While you were away" onClose={onClose}>
    <Section title="Added" items={added} />
    <Section title="Completed" items={completed} />
    <Section title="Notes updated" items={notesChanged} />
  </Overlay>;
}

function SettingsPanel({ onClose, onExport, onImport, loveTexts, onSaveLoveNotes }) {
  const fileInputRef = useRef(null);
  const [draft, setDraft] = useState("");
  const [preview, setPreview] = useState(null);
  const addLove = () => {
    if (!draft.trim()) return;
    onSaveLoveNotes([...loveTexts, draft.trim()]);
    setDraft("");
  };
  return /*#__PURE__*/<Overlay title="Settings" onClose={onClose}>
    <div style={{ marginBottom: 22, paddingBottom: 18, borderBottom: `1px solid ${C.rule}` }}>
      <div style={{ fontFamily: "Fraunces, serif", fontSize: 16, fontWeight: 600, color: C.ink, marginBottom: 4 }}>Love notes</div>
      <div style={{ fontSize: 11, color: C.inkSoft, marginBottom: 10, lineHeight: 1.4 }}>John's loading screen shows one of these each time he opens the app (and stays up for 4 seconds). Anyone who opens Settings can read them.</div>
      {loveTexts.length === 0 && <div style={{ fontSize: 12, color: C.inkSoft, marginBottom: 8 }}>No notes yet.</div>}
      {loveTexts.map((txt, i) => <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.rule}66` }}>
        <div style={{ flex: 1, fontSize: 13, color: C.ink, fontStyle: "italic", lineHeight: 1.35 }}>{txt}</div>
        <button onClick={() => onSaveLoveNotes(loveTexts.filter((_, j) => j !== i))} aria-label="Delete note" style={{ border: "none", background: "none", color: C.inkSoft, cursor: "pointer", fontSize: 14 }}>×</button>
      </div>)}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addLove(); }} placeholder="Write a note…" style={{ flex: 1, minWidth: 0, padding: "9px 10px", borderRadius: 8, border: `1px solid ${C.rule}`, background: C.white, fontSize: 13, color: C.ink }} />
        <button onClick={addLove} disabled={!draft.trim()} style={{ ...btnStyle(C.ink), opacity: draft.trim() ? 1 : 0.4 }}>Add</button>
      </div>
      {loveTexts.length > 0 && <button onClick={() => setPreview(loveTexts[Math.floor(Math.random() * loveTexts.length)])} style={{ border: "none", background: "none", color: C.inkSoft, textDecoration: "underline", fontSize: 11.5, cursor: "pointer", padding: 0, marginTop: 10 }}>Preview a note</button>}
    </div>
    {preview && <div onClick={() => setPreview(null)} style={{ position: "fixed", inset: 0, zIndex: 1000, background: C.parchment, display: "flex", alignItems: "center", justifyContent: "center", padding: 32, textAlign: "center", cursor: "pointer" }}>
      <div style={{ fontFamily: "Fraunces, serif", fontStyle: "italic", fontSize: 22, lineHeight: 1.4, color: C.ink, maxWidth: 300 }}>{preview}<div style={{ fontStyle: "normal", fontSize: 14, marginTop: 10, color: C.inkSoft }}>- Jade</div><div style={{ fontFamily: "inherit", fontStyle: "normal", fontSize: 11, color: C.inkSoft, marginTop: 22 }}>Tap to close</div></div>
    </div>}
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, color: C.inkSoft, marginBottom: 8, lineHeight: 1.4 }}>Download everything as a JSON file — a safety copy you can keep, separate from Firestore.</div>
      <button onClick={onExport} style={{ ...btnStyle(C.ink), width: "100%" }}>Export data</button>
    </div>
    <div>
      <div style={{ fontSize: 11, color: C.inkSoft, marginBottom: 8, lineHeight: 1.4 }}>Restore from a previously exported file. This replaces everything currently in the app — can't be undone.</div>
      <input type="file" accept="application/json" ref={fileInputRef} style={{ display: "none" }} onChange={e => {
        if (e.target.files[0]) {
          onImport(e.target.files[0]);
          e.target.value = "";
        }
      }} />
      <button onClick={() => fileInputRef.current.click()} style={{ width: "100%", padding: "10px 0", borderRadius: 10, border: `1px solid ${C.plum}`, background: "transparent", color: C.plum, fontSize: 13.5, fontWeight: 600, cursor: "pointer" }}>Import data</button>
    </div>
  </Overlay>;
}

/* ---------- to-do list: a simple first pass — urgent/pressing items across everything visible to me ---------- */
const DAY_MS = 86400000;
const SOON_DAYS = 3; // "due soon" window
const STALE_DAYS_DEFAULT = 60; // fallback for one-off (non-recurring) tasks
const LINGER_MS = 48 * 3600 * 1000; // how long a just-completed task stays visible

function urgencyBand(dueDate, todayStr) {
  if (!dueDate) return "none";
  if (dueDate < todayStr) return "overdue";
  const diff = Math.round((new Date(dueDate + "T00:00:00") - new Date(todayStr + "T00:00:00")) / DAY_MS);
  if (diff <= SOON_DAYS) return "soon";
  return "later";
}
/* approximate recurrence period in days, or null for one-off tasks */
function recurrencePeriodDays(rec) {
  const r = normRecurrence(rec);
  if (r.unit === "none") return null;
  if (r.unit === "day") return r.amount;
  if (r.unit === "week") return r.amount * 7;
  if (r.unit === "month") return r.amount * 30;
  return null;
}

/* Strict two-level ranking: high/med importance ALWAYS outranks low/none, with zero exceptions.
   Within that group, urgency (overdue > soon > later) decides order; importance is only a fine tiebreak. */
function tierFor(dueDate, priority, todayStr) {
  const group = priority === "high" || priority === "med" ? 0 : 1; // 0 = not-low, always first
  const u = urgencyBand(dueDate, todayStr);
  const urgencyRank = u === "overdue" ? 0 : u === "soon" ? 1 : 2;
  const tie = priority === "high" ? 0 : priority === "med" ? 1 : priority === "low" ? 2 : 3;
  return group * 100 + urgencyRank * 10 + tie;
}

/* a compact row representing a project's next action, standing in for the whole project */
function ActionAsRow({
  task,
  action,
  onToggleAction,
  onEdit,
  onSnooze,
  onAddToToday,
  onRestore,
  onToggleManualTodo
}) {
  const overdue = action.dueDate && action.dueDate < adelaideToday();
  const imp = IMPORTANCE.find(x => x.key === task.priority) || null;
  return /*#__PURE__*/<div style={{
    background: C.card,
    border: `1px solid ${C.rule}`,
    borderRadius: 10,
    padding: "11px 12px",
    marginBottom: 8
  }}><div style={{
      display: "flex",
      alignItems: "flex-start",
      gap: 10
    }}><button onClick={() => onToggleAction(task.id, action.id)} style={{
        width: 20,
        height: 20,
        borderRadius: "50%",
        border: `2px solid ${imp ? imp.color : C.inkSoft}`,
        background: "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
        marginTop: 1
      }} /><div style={{
        flex: 1,
        minWidth: 0
      }}><div onClick={() => onEdit(task)} style={{
          cursor: "pointer"
        }}><div style={{
            fontSize: 14,
            color: C.ink,
            fontWeight: 600
          }}>{action.title}</div><div style={{
            fontSize: 11,
            color: C.inkSoft,
            marginTop: 2
          }}>↳ {task.title}</div><div style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginTop: 5,
            alignItems: "center"
          }}><span style={{
              fontSize: 10.5,
              fontFamily: "IBM Plex Mono, monospace",
              color: overdue ? C.plum : C.inkSoft,
              fontWeight: overdue ? 700 : 500
            }}>{fmtDate(action.dueDate || task.dueDate)}</span></div></div>{onSnooze && /*#__PURE__*/<div style={{
          marginTop: 6
        }}><SnoozeControl onSnooze={onSnooze} /></div>}</div><div style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        alignItems: "stretch",
        flexShrink: 0
      }}>{onAddToToday && /*#__PURE__*/<button onClick={() => onAddToToday(task.id, action.id)} style={{
          border: `1px solid ${C.rule}`,
          background: C.white,
          color: C.sageDeep,
          cursor: "pointer",
          padding: "2px 8px",
          fontSize: 11,
          fontWeight: 600,
          borderRadius: 6,
          whiteSpace: "nowrap"
        }}>+ The plan</button>}{onToggleManualTodo && /*#__PURE__*/<button onClick={() => onToggleManualTodo(task.id)} style={{
          border: `1px solid ${task.manualTodo ? C.sage : C.rule}`,
          background: task.manualTodo ? "#E3EBDD" : C.white,
          color: C.sageDeep,
          cursor: "pointer",
          padding: "2px 8px",
          fontSize: 11,
          fontWeight: 600,
          borderRadius: 6,
          whiteSpace: "nowrap"
        }}>{task.manualTodo ? "− List" : "+ List"}</button>}{onRestore && /*#__PURE__*/<button onClick={() => onRestore()} style={{
          border: `1px solid ${C.rule}`,
          background: C.white,
          color: C.sageDeep,
          cursor: "pointer",
          padding: "2px 8px",
          fontSize: 11,
          fontWeight: 600,
          borderRadius: 6,
          whiteSpace: "nowrap"
        }}>Restore</button>}</div></div></div>;
}
function snoozeTarget(kind) {
  const d = new Date(adelaideToday() + "T00:00:00");
  if (kind === "tomorrow") d.setDate(d.getDate() + 1);else if (kind === "next-weekend") {
    const day = d.getDay();
    const diff = (6 - day + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
  } else if (kind === "next-month") d.setMonth(d.getMonth() + 1);
  return ymdLocal(d);
}
const notStartableYet = (t, todayStr) => {
  const eff = effectiveDueDate(t);
  return t.startsOnDue && !!eff && eff > todayStr;
};
const isFadedTask = (t, todayStr) => notStartableYet(t, todayStr) && !t.completed;

/* shared "not today" control — used on the hero card and, in overwhelmed mode, on every row */
function SnoozeControl({
  onSnooze
}) {
  const [mode, setMode] = useState("closed"); // closed | options | custom
  const [customDate, setCustomDate] = useState("");
  const pillStyle = {
    background: C.ink,
    color: C.white,
    border: "1px solid rgba(255,255,255,0.25)",
    borderRadius: 8,
    padding: "5px 11px",
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer"
  };
  const closeBtn = onClick => /*#__PURE__*/<button onClick={onClick} style={{
    background: C.ink,
    color: C.white,
    border: "1px solid rgba(255,255,255,0.25)",
    borderRadius: "50%",
    width: 24,
    height: 24,
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0
  }}>×</button>;
  if (mode === "closed") {
    return /*#__PURE__*/<button onClick={() => setMode("options")} style={{
      background: C.ink,
      color: C.white,
      border: "1px solid rgba(255,255,255,0.25)",
      borderRadius: 20,
      padding: "5px 14px",
      fontSize: 11.5,
      fontWeight: 700,
      cursor: "pointer"
    }}>Not today</button>;
  }
  if (mode === "custom") {
    return /*#__PURE__*/<div style={{
      display: "flex",
      gap: 6,
      flexWrap: "wrap",
      alignItems: "center"
    }}><input type="date" value={customDate} onChange={e => setCustomDate(e.target.value)} style={{
        fontSize: 12,
        padding: "5px 8px",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.3)",
        background: C.ink,
        color: C.white
      }} /><button onClick={() => {
        if (customDate) {
          onSnooze(customDate);
          setMode("closed");
        }
      }} disabled={!customDate} style={{
        ...pillStyle,
        opacity: customDate ? 1 : 0.5
      }}>Set</button>{closeBtn(() => setMode("closed"))}</div>;
  }
  return /*#__PURE__*/<div style={{
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    alignItems: "center"
  }}>{[["tomorrow", "Tomorrow"], ["next-weekend", "Next weekend"], ["next-month", "Next month"]].map(([k, l]) => /*#__PURE__*/<button key={k} onClick={() => {
      onSnooze(snoozeTarget(k));
      setMode("closed");
    }} style={pillStyle}>{l}</button>)}<button onClick={() => setMode("custom")} style={pillStyle}>Custom date</button>{closeBtn(() => setMode("closed"))}</div>;
}

/* prominent card for "overwhelmed" mode — swipe right to put it on The Plan, left to skip it until midnight.
   The buttons underneath do the same thing for anyone who'd rather tap. */
function HeroCard({
  pick,
  onPlan,
  onSkip,
  onToggle,
  onToggleAction,
  onEdit,
  onSnooze
}) {
  const isProject = pick.kind === "project" || pick.kind === "otherProject";
  const task = isProject ? pick.item.task : pick.item;
  const driving = isProject ? pick.item.action : drivingSubtask(task);
  const title = driving ? driving.title : task.title;
  const dueDate = driving ? driving.dueDate || task.dueDate : effectiveDueDate(task);
  const imp = IMPORTANCE.find(x => x.key === task.priority) || null;
  const THRESHOLD = 90;
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState(null); // "plan" | "skip" while the card flies off
  const drag = useRef(null);
  const moved = useRef(false);
  const finish = dir => {
    setLeaving(dir);
    setTimeout(() => {
      if (dir === "plan") onPlan();else onSkip();
    }, 190);
  };
  const onDown = e => {
    if (leaving) return;
    if (e.target.closest && e.target.closest("button, input, select")) return;
    drag.current = {
      x: e.clientX,
      id: e.pointerId
    };
    moved.current = false;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (err) {}
  };
  const onMove = e => {
    if (!drag.current) return;
    const d = e.clientX - drag.current.x;
    if (Math.abs(d) > 6) moved.current = true;
    setDx(d);
  };
  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    if (dx > THRESHOLD) finish("plan");else if (dx < -THRESHOLD) finish("skip");else setDx(0);
  };
  const shift = leaving === "plan" ? 520 : leaving === "skip" ? -520 : dx;
  const strength = Math.min(Math.abs(shift) / THRESHOLD, 1);
  // Skip / Plan: present but quiet, tucked toward the card's edges (swiping is the main way to use them)
  const quietBtn = {
    background: "transparent",
    color: "rgba(255,255,255,0.55)",
    border: "none",
    padding: "8px 8px",
    fontSize: 12,
    cursor: "pointer"
  };
  return /*#__PURE__*/<div style={{
    background: C.ink,
    color: C.white,
    borderRadius: 20,
    padding: "30px 24px",
    textAlign: "center",
    boxShadow: "0 14px 34px rgba(43,42,40,0.3)",
    marginBottom: 18,
    position: "relative",
    touchAction: "pan-y",
    userSelect: "none",
    transform: `translateX(${shift}px) rotate(${shift / 24}deg)`,
    transition: drag.current ? "none" : "transform 0.19s ease-out",
    opacity: leaving ? 0 : 1
  }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}><div style={{
      position: "absolute",
      top: 16,
      left: 18,
      fontSize: 13,
      fontWeight: 800,
      letterSpacing: 1.5,
      textTransform: "uppercase",
      border: "2px solid #B7D3A6",
      color: "#B7D3A6",
      borderRadius: 8,
      padding: "2px 9px",
      transform: "rotate(-8deg)",
      opacity: shift > 0 ? strength : 0
    }}>Plan</div><div style={{
      position: "absolute",
      top: 16,
      right: 18,
      fontSize: 13,
      fontWeight: 800,
      letterSpacing: 1.5,
      textTransform: "uppercase",
      border: "2px solid rgba(255,255,255,0.7)",
      color: "rgba(255,255,255,0.85)",
      borderRadius: 8,
      padding: "2px 9px",
      transform: "rotate(8deg)",
      opacity: shift < 0 ? strength : 0
    }}>Skip</div><div style={{
      fontSize: 10,
      opacity: 0.55,
      marginBottom: 10,
      textTransform: "uppercase",
      letterSpacing: 1
    }}>Most pressing right now</div>{driving && /*#__PURE__*/<div style={{
      fontSize: 11,
      opacity: 0.6,
      marginBottom: 8,
      textTransform: "uppercase",
      letterSpacing: 0.5
    }}>from {task.title}</div>}{imp && /*#__PURE__*/<div style={{
      display: "inline-block",
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: 0.5,
      textTransform: "uppercase",
      background: imp.color,
      color: C.white,
      padding: "3px 11px",
      borderRadius: 20,
      marginBottom: 14
    }}>{imp.label} importance</div>}<div onClick={() => {
      if (!moved.current) onEdit(task);
    }} style={{
      fontFamily: "Fraunces, serif",
      fontSize: 26,
      fontWeight: 600,
      lineHeight: 1.25,
      marginBottom: 12,
      cursor: "pointer"
    }}>{title}</div><div style={{
      fontFamily: "IBM Plex Mono, monospace",
      fontSize: 13,
      opacity: 0.8,
      marginBottom: 14
    }}>{fmtDate(dueDate)}</div><div style={{
      fontSize: 10.5,
      opacity: 0.5,
      marginBottom: 14
    }} /><div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 18,
      marginLeft: -10,
      marginRight: -10
    }}><button onClick={() => finish("skip")} style={quietBtn}>← Skip</button><button onClick={() => driving ? onToggleAction(task.id, driving.id) : onToggle(task)} style={{
        background: C.white,
        color: C.ink,
        border: "none",
        borderRadius: 10,
        padding: "11px 22px",
        fontWeight: 700,
        fontSize: 14,
        cursor: "pointer"
      }}>Done</button><button onClick={() => finish("plan")} style={quietBtn}>Plan →</button></div><div style={{
      display: "flex",
      justifyContent: "center"
    }}><SnoozeControl onSnooze={onSnooze} /></div></div>;
}
function upcomingLeadDays(periodDays) {
  if (periodDays == null) return 7; // one-off tasks: a week's notice before their single due date
  if (periodDays >= 300) return 30; // yearly-ish
  if (periodDays >= 150) return 14; // ~6-monthly
  if (periodDays >= 7) return 3; // weekly through ~5-monthly
  return 1; // more frequent than weekly
}
/* A recurring chore only clutters the main Chores list once it's actually due or close to due — this applies
   the same lead-window scaling as Upcoming to EVERY recurring chore, not just ones with "Due date is do date"
   checked. Completing a monthly chore today rolls its due date a month out, and it should disappear from the
   list until it's genuinely relevant again, without needing that box ticked. One-off (non-repeating) chores
   are unaffected — they keep showing regardless of distance, same as always. */
function withinLeadWindow(t, todayStr) {
  const eff = effectiveDueDate(t);
  if (!eff || eff <= todayStr) return true;
  const period = recurrencePeriodDays(t.recurrence);
  if (!period) return true;
  const daysUntil = Math.round((new Date(eff + "T00:00:00") - new Date(todayStr + "T00:00:00")) / DAY_MS);
  return daysUntil <= upcomingLeadDays(period);
}
function ToDoList({
  tasks,
  me,
  onToggle,
  onEdit,
  onDelete,
  onToggleAction,
  onAddAction,
  onDeleteAction,
  onReorderAction,
  onSetTaskActions,
  onSetActionDueDate,
  onSetTaskDueDate,
  onSetTaskHiddenUntil,
  onSetActionHiddenUntil,
  onToggleManualTodo,
  todayItems,
  onAddSundry,
  onToggleSundry,
  onDeleteSundry,
  onAddTaskToToday,
  onRemoveTaskFromToday,
  onReorderToday,
  onReorderTodayBucketFull,
  onResetToday,
  onSetTodayBucket,
  onToggleTodayTaskDone,
  onConvertNote
}) {
  const [overwhelmed, setOverwhelmed] = useState(false);
  const [skipped, setSkipped] = useState(() => loadSkipped(me));
  // remembered on this device: whether the lists under the plan are collapsed
  const [collapsedAll, setCollapsedAll] = useState(() => {
    try {
      return localStorage.getItem("lifelist-todo-collapsed") === "1";
    } catch (e) {
      return false;
    }
  });
  const toggleCollapsedAll = () => setCollapsedAll(c => {
    try {
      localStorage.setItem("lifelist-todo-collapsed", c ? "0" : "1");
    } catch (e) {}
    return !c;
  });
  useEffect(() => {
    setSkipped(loadSkipped(me));
  }, [me]);
  const today = adelaideToday();
  const now = Date.now();

  // "just checked off" linger: keep a task looking done, in its original spot, for ~5s before it actually
  // moves to Recently Completed — without this, a task (especially a recurring one, whose due date jumps
  // forward immediately) would vanish from view the instant you tap it, with no visible confirmation.
  const [pendingComplete, setPendingComplete] = useState({}); // taskId -> { snapshot, expiry }
  useEffect(() => {
    const entries = Object.entries(pendingComplete);
    if (!entries.length) return;
    const timers = entries.map(([id, {
      expiry
    }]) => setTimeout(() => setPendingComplete(p => {
      const n = {
        ...p
      };
      delete n[id];
      return n;
    }), Math.max(expiry - Date.now(), 0)));
    return () => timers.forEach(clearTimeout);
  }, [pendingComplete]);
  const wrappedToggle = task => {
    if (!task.completed) {
      setPendingComplete(p => ({
        ...p,
        [task.id]: {
          snapshot: {
            ...task,
            completed: true
          },
          expiry: Date.now() + 5000
        }
      }));
    }
    onToggle(task);
  };
  const effectiveTasks = useMemo(() => tasks.map(t => pendingComplete[t.id] ? pendingComplete[t.id].snapshot : t), [tasks, pendingComplete]);
  const assignedToMe = useMemo(() => effectiveTasks.filter(t => t.scope === "personal" ? t.owner === me : t.assignee === me || !t.assignee), [effectiveTasks, me]);
  const justDone = useMemo(() => tasks.filter(t => t.lastCompletedAt && now - t.lastCompletedAt < LINGER_MS && !pendingComplete[t.id]).sort((a, b) => (b.lastCompletedAt || 0) - (a.lastCompletedAt || 0)), [tasks, now, pendingComplete]);

  // upcoming: recurring, "due date is start date" tasks approaching their window — computed before the
  // not-startable-yet exclusion below, since this IS how those tasks get any visibility before they're due.
  // Uses effective date, so a subtask due sooner correctly pulls the task out of Upcoming and into the active list.
  const upcoming = useMemo(() => assignedToMe.filter(t => {
    if (t.completed || !t.startsOnDue) return false;
    const eff = effectiveDueDate(t);
    if (!eff || eff <= today) return false;
    const period = recurrencePeriodDays(t.recurrence); // null for one-off tasks — upcomingLeadDays handles that
    const daysUntil = Math.round((new Date(eff + "T00:00:00") - new Date(today + "T00:00:00")) / DAY_MS);
    return daysUntil <= upcomingLeadDays(period);
  }).sort((a, b) => (effectiveDueDate(a) || "9999").localeCompare(effectiveDueDate(b) || "9999")), [assignedToMe, today]);
  const isHidden = t => t.hiddenUntil && t.hiddenUntil[me] && t.hiddenUntil[me] > today;
  const isActionHidden = a => a.hiddenUntil && a.hiddenUntil[me] && a.hiddenUntil[me] > today;
  const active = useMemo(() => assignedToMe.filter(t => (!t.completed || pendingComplete[t.id]) && !notStartableYet(t, today) && !isHidden(t)), [assignedToMe, today, pendingComplete]);

  // postponed ("not today"): due date untouched, so these still show their true overdue state wherever displayed —
  // only hidden from the ranked to-do list (for the person who postponed it) until hiddenUntil passes, then it
  // quietly reappears on its own.
  const postponedChores = useMemo(() => assignedToMe.filter(t => !t.completed && t.listType === "chore" && isHidden(t)), [assignedToMe, today]);
  const postponedProjectItems = useMemo(() => assignedToMe.filter(t => !t.completed && t.listType === "project").map(t => ({
    task: t,
    action: (t.actions || []).find(a => !a.completed && isActionHidden(a))
  })).filter(({
    action
  }) => !!action), [assignedToMe, today]);

  // chores: dated (own date, or a nearer subtask date) OR manually added despite having no date; ranked by
  // tier on the effective date, with date-less manual adds sorting to the bottom of their importance group.
  // Recurring chores only appear once within their lead window (or overdue) — see withinLeadWindow.
  const chores = useMemo(() => active.filter(t => t.listType === "chore" && (!!effectiveDueDate(t) || t.manualTodo)).filter(t => t.manualTodo || withinLeadWindow(t, today)).sort((a, b) => {
    const da = effectiveDueDate(a),
      db = effectiveDueDate(b);
    const ta = tierFor(da, a.priority, today),
      tb = tierFor(db, b.priority, today);
    if (ta !== tb) return ta - tb;
    return (da || "9999").localeCompare(db || "9999");
  }), [active, today]);

  // Priority Projects: pinned in the Priorities grid for the viewed person — their first/next action always
  // shows, even with no priority or due date of its own (falls back to the project's own date, or no date at all).
  // if that next action was postponed, the project sits out of the to-do list until it passes.
  // Projects with no incomplete subtask at all just display as themselves (no action to show instead).
  const priorityProjectItems = useMemo(() => {
    const items = active.filter(t => t.listType === "project" && t.gridBucket && t.gridBucket[me]).map(t => ({
      task: t,
      action: nextAction(t)
    })).filter(({
      action
    }) => !(action && isActionHidden(action)));
    return items.sort((a, b) => {
      const da = a.action && a.action.dueDate || a.task.dueDate,
        db = b.action && b.action.dueDate || b.task.dueDate;
      const ta = tierFor(da, a.task.priority, today),
        tb = tierFor(db, b.task.priority, today);
      if (ta !== tb) return ta - tb;
      return (da || "9999").localeCompare(db || "9999");
    });
  }, [active, me, today]);

  // Other Projects: manually added but not pinned — shown the same way, just ranked below Priority Projects
  const otherProjectItems = useMemo(() => {
    const items = active.filter(t => t.listType === "project" && t.manualTodo && !(t.gridBucket && t.gridBucket[me])).map(t => ({
      task: t,
      action: nextAction(t)
    })).filter(({
      action
    }) => !(action && isActionHidden(action)));
    return items.sort((a, b) => {
      const da = a.action && a.action.dueDate || a.task.dueDate,
        db = b.action && b.action.dueDate || b.task.dueDate;
      const ta = tierFor(da, a.task.priority, today),
        tb = tierFor(db, b.task.priority, today);
      if (ta !== tb) return ta - tb;
      return (da || "9999").localeCompare(db || "9999");
    });
  }, [active, me, today]);
  // kept as an alias so the rest of this component (topPick, overwhelmed exclusion, etc.) reads naturally
  const projectItems = priorityProjectItems;
  const rowProps = {
    me,
    onToggle: wrappedToggle,
    onEdit,
    onDelete,
    onToggleAction,
    onAddAction,
    onDeleteAction,
    onReorderAction,
    onSetTaskActions,
    onSetActionDueDate
  };

  // the overwhelmed card stack: every chore / project action that could be done now, most urgent + most important first,
  // minus anything already on today's plan or skipped until midnight
  const pickKey = pick => pick.kind === "chore" ? `${pick.item.id}:${(drivingSubtask(pick.item) || {}).id || ""}` : `${pick.item.task.id}:${pick.item.action ? pick.item.action.id : ""}`;
  const pickStack = useMemo(() => {
    const out = [];
    chores.forEach(t => {
      const due = effectiveDueDate(t);
      out.push({
        kind: "chore",
        tier: tierFor(due, t.priority, today),
        due: due || "9999",
        item: t
      });
    });
    projectItems.forEach(item => {
      const due = item.action && item.action.dueDate || item.task.dueDate;
      out.push({
        kind: "project",
        tier: tierFor(due, item.task.priority, today),
        due: due || "9999",
        item
      });
    });
    otherProjectItems.forEach(item => {
      const due = item.action && item.action.dueDate || item.task.dueDate;
      out.push({
        kind: "otherProject",
        tier: tierFor(due, item.task.priority, today),
        due: due || "9999",
        item
      });
    });
    const planned = pick => {
      const taskId = pick.kind === "chore" ? pick.item.id : pick.item.task.id;
      const sub = pick.kind === "chore" ? (drivingSubtask(pick.item) || {}).id || null : pick.item.action ? pick.item.action.id : null;
      return todayItems.some(it => it.type === "task" && it.id === taskId && (it.subtaskId || null) === sub);
    };
    return out.filter(p => !skipped.includes(pickKey(p)) && !planned(p)).sort((x, y) => x.tier - y.tier || x.due.localeCompare(y.due));
  }, [chores, projectItems, otherProjectItems, today, skipped, todayItems]);
  const topPick = pickStack[0] || null;
  const skipPick = pick => {
    const next = [...skipped, pickKey(pick)];
    setSkipped(next);
    saveSkipped(me, next);
  };
  const resetSkips = () => {
    setSkipped([]);
    saveSkipped(me, []);
  };
  const planPick = pick => {
    if (pick.kind === "chore") onAddTaskToToday(pick.item.id, (drivingSubtask(pick.item) || {}).id || null);else onAddTaskToToday(pick.item.task.id, pick.item.action ? pick.item.action.id : null);
  };

  // "Not today" postpones — real due date is left alone, so overdue/stale status stays honest; the item just
  // moves into the Postponed section until the chosen date, then quietly reappears in normal rank.
  const snoozeChore = (task, dateStr) => onSetTaskHiddenUntil(task.id, dateStr);
  const snoozeProjectAction = (task, action, dateStr) => onSetActionHiddenUntil(task.id, action.id, dateStr);
  const sameItem = (a, b) => a.task.id === b.task.id && (a.action ? a.action.id : null) === (b.action ? b.action.id : null);
  const displayChores = overwhelmed && topPick && topPick.kind === "chore" ? chores.filter(t => t.id !== topPick.item.id) : chores;
  const displayProjects = overwhelmed && topPick && topPick.kind === "project" ? projectItems.filter(item => !sameItem(item, topPick.item)) : projectItems;
  const displayOtherProjects = overwhelmed && topPick && topPick.kind === "otherProject" ? otherProjectItems.filter(item => !sameItem(item, topPick.item)) : otherProjectItems;
  const inPlan = (taskId, subtaskId) => todayItems.some(it => it.type === "task" && it.id === taskId && (it.subtaskId || null) === (subtaskId || null));
  const tasksById = useMemo(() => {
    const m = {};
    tasks.forEach(t => {
      m[t.id] = t;
    });
    return m;
  }, [tasks]);
  return /*#__PURE__*/<div style={{
    height: "calc(100% - 120px)",
    overflowY: "auto",
    padding: "14px 16px 90px"
  }}><button onClick={() => setOverwhelmed(o => !o)} style={{
      width: "100%",
      border: `1px solid ${C.rule}`,
      background: overwhelmed ? C.ink : C.card,
      color: overwhelmed ? C.white : C.inkSoft,
      borderRadius: 8,
      padding: "7px 0",
      fontSize: 12,
      fontWeight: 600,
      cursor: "pointer",
      marginBottom: 12
    }}>{overwhelmed ? "Turn off overwhelmed mode" : "I'm overwhelmed — help me prioritise"}</button>{overwhelmed && skipped.length > 0 && /*#__PURE__*/<div style={{
      textAlign: "center",
      marginTop: -6,
      marginBottom: 12
    }}><button onClick={resetSkips} style={{
        border: "none",
        background: "none",
        color: C.inkSoft,
        fontSize: 11.5,
        textDecoration: "underline",
        cursor: "pointer"
      }}>Start over ({skipped.length} skipped)</button></div>}{overwhelmed && !topPick && /*#__PURE__*/<div style={{
      background: C.ink,
      color: C.white,
      borderRadius: 20,
      padding: "34px 24px",
      textAlign: "center",
      marginBottom: 18,
      fontFamily: "Fraunces, serif",
      fontSize: 20
    }}>All caught up for now</div>}{overwhelmed && topPick && /*#__PURE__*/<HeroCard key={pickKey(topPick)} pick={topPick} onPlan={() => planPick(topPick)} onSkip={() => skipPick(topPick)} onToggle={wrappedToggle} onToggleAction={onToggleAction} onEdit={onEdit} onSnooze={dateStr => {
      if (topPick.kind === "project" || topPick.kind === "otherProject") {
        if (topPick.item.action) snoozeProjectAction(topPick.item.task, topPick.item.action, dateStr);else snoozeChore(topPick.item.task, dateStr);
        return;
      }
      const driving = drivingSubtask(topPick.item);
      if (driving) snoozeProjectAction(topPick.item, driving, dateStr);else snoozeChore(topPick.item, dateStr);
    }} />}<TodayPlanSection items={todayItems} tasksById={tasksById} onAddSundry={onAddSundry} onAddExisting={onAddTaskToToday} onToggleSundry={onToggleSundry} onDeleteSundry={onDeleteSundry} onReorderBucketFull={onReorderTodayBucketFull} onRemoveTask={onRemoveTaskFromToday} onReset={onResetToday} onSetBucket={onSetTodayBucket} onToggle={onToggle} onToggleAction={onToggleAction} onEdit={onEdit} onToggleTodayTaskDone={onToggleTodayTaskDone} onConvertNote={onConvertNote} /><div style={{
      textAlign: "right",
      marginBottom: 6
    }}><button onClick={toggleCollapsedAll} style={{
        border: "none",
        background: "none",
        color: C.inkSoft,
        fontSize: 11.5,
        textDecoration: "underline",
        cursor: "pointer",
        padding: 0
      }}>{collapsedAll ? "Expand all" : "Collapse all"}</button></div>{displayChores.length === 0 && displayProjects.length === 0 && displayOtherProjects.length === 0 && justDone.length === 0 && /*#__PURE__*/<div style={{
      color: C.inkSoft,
      fontSize: 13,
      textAlign: "center",
      marginTop: 40
    }}>Nothing pressing right now.</div>}{displayChores.length > 0 && /*#__PURE__*/<CollapsibleSection collapsedAll={collapsedAll} title="Chores" count={displayChores.length} defaultOpen={true}>{displayChores.map(t => {
        const driving = drivingSubtask(t);
        return driving ? /*#__PURE__*/<ActionAsRow key={t.id} task={t} action={driving} onToggleAction={onToggleAction} onEdit={onEdit} onSnooze={overwhelmed ? dateStr => snoozeProjectAction(t, driving, dateStr) : undefined} onAddToToday={inPlan(t.id, driving.id) ? undefined : onAddTaskToToday} onToggleManualTodo={t.manualTodo ? onToggleManualTodo : undefined} /> : /*#__PURE__*/<TaskRow key={t.id} task={t} {...rowProps} onSnooze={overwhelmed ? dateStr => snoozeChore(t, dateStr) : undefined} onAddToToday={inPlan(t.id, null) ? undefined : onAddTaskToToday} onToggleManualTodo={t.manualTodo ? onToggleManualTodo : undefined} />;
      })}</CollapsibleSection>}{displayProjects.length > 0 && /*#__PURE__*/<CollapsibleSection collapsedAll={collapsedAll} title="Priority Projects" count={displayProjects.length} defaultOpen={true}>{displayProjects.map(({
        task,
        action
      }) => {
        const d = action && action.dueDate || task.dueDate;
        const notYetDue = !!d && d > today;
        return /*#__PURE__*/<div key={task.id + (action ? action.id : "")} style={notYetDue ? {
          opacity: 0.55
        } : undefined}>{action ? /*#__PURE__*/<ActionAsRow task={task} action={action} onToggleAction={onToggleAction} onEdit={onEdit} onSnooze={overwhelmed ? kind => snoozeProjectAction(task, action, kind) : undefined} onAddToToday={inPlan(task.id, action.id) ? undefined : onAddTaskToToday} /> : /*#__PURE__*/<TaskRow task={task} {...rowProps} onSnooze={overwhelmed ? dateStr => snoozeChore(task, dateStr) : undefined} onAddToToday={inPlan(task.id, null) ? undefined : onAddTaskToToday} />}</div>;
      })}</CollapsibleSection>}{displayOtherProjects.length > 0 && /*#__PURE__*/<CollapsibleSection collapsedAll={collapsedAll} title="Other Projects" count={displayOtherProjects.length} defaultOpen={true}>{displayOtherProjects.map(({
        task,
        action
      }) => action ? /*#__PURE__*/<ActionAsRow key={task.id + action.id} task={task} action={action} onToggleAction={onToggleAction} onEdit={onEdit} onSnooze={overwhelmed ? dateStr => snoozeProjectAction(task, action, dateStr) : undefined} onAddToToday={inPlan(task.id, action.id) ? undefined : onAddTaskToToday} onToggleManualTodo={onToggleManualTodo} /> : /*#__PURE__*/<TaskRow key={task.id} task={task} {...rowProps} onSnooze={overwhelmed ? dateStr => snoozeChore(task, dateStr) : undefined} onAddToToday={inPlan(task.id, null) ? undefined : onAddTaskToToday} onToggleManualTodo={onToggleManualTodo} />)}</CollapsibleSection>}<CollapsibleSection collapsedAll={collapsedAll} title="Postponed" count={postponedChores.length + postponedProjectItems.length} defaultOpen={false}><div style={{
        fontSize: 11,
        color: C.inkSoft,
        marginBottom: 6
      }}>Marked "not today" — still overdue if they were, just out of the way until the date you picked.</div>{postponedChores.length === 0 && postponedProjectItems.length === 0 && /*#__PURE__*/<div style={{
        color: C.inkSoft,
        fontSize: 12,
        textAlign: "center",
        padding: "10px 0"
      }}>Nothing postponed right now.</div>}{postponedChores.map(t => /*#__PURE__*/<TaskRow key={t.id} task={t} {...rowProps} onRestore={() => onSetTaskHiddenUntil(t.id, null)} onAddToToday={inPlan(t.id, null) ? undefined : onAddTaskToToday} />)}{postponedProjectItems.map(({
        task,
        action
      }) => /*#__PURE__*/<ActionAsRow key={task.id + action.id} task={task} action={action} onToggleAction={onToggleAction} onEdit={onEdit} onRestore={() => onSetActionHiddenUntil(task.id, action.id, null)} onAddToToday={inPlan(task.id, action.id) ? undefined : onAddTaskToToday} />)}</CollapsibleSection><CollapsibleSection collapsedAll={collapsedAll} title="Upcoming" count={upcoming.length} defaultOpen={false}><div style={{
        fontSize: 11,
        color: C.inkSoft,
        marginBottom: 6
      }}>Recurring, can't-start-early tasks whose window is approaching.</div>{upcoming.length === 0 && /*#__PURE__*/<div style={{
        color: C.inkSoft,
        fontSize: 12,
        textAlign: "center",
        padding: "10px 0"
      }}>Nothing coming up yet.</div>}{upcoming.map(t => /*#__PURE__*/<TaskRow key={t.id} task={t} {...rowProps} onAddToToday={inPlan(t.id, null) ? undefined : onAddTaskToToday} />)}</CollapsibleSection>{justDone.length > 0 && /*#__PURE__*/<CollapsibleSection collapsedAll={collapsedAll} title="Recently completed" count={justDone.length} defaultOpen={false}>{justDone.map(t => /*#__PURE__*/<TaskRow key={t.id} task={t} {...rowProps} showAsCompleted={true} onAddToToday={inPlan(t.id, null) ? undefined : onAddTaskToToday} />)}</CollapsibleSection>}</div>;
}

/* compact "Today's plan" — just titles, sits at the top of the list like the hero card does for overwhelmed mode */
function TodayItemRow({
  item,
  tasksById,
  onToggleSundry,
  onDeleteSundry,
  onRemoveTask,
  onToggle,
  onToggleAction,
  onEdit,
  onMove,
  moveLabel,
  onToggleTodayTaskDone,
  onConvertNote,
  startDrag
}) {
  const task = item.type === "task" ? tasksById[item.id] : null;
  const subtask = task && item.subtaskId ? (task.actions || []).find(a => a.id === item.subtaskId) : null;
  let title, completed, onCheck;
  const isNote = item.type === "sundry"; // quick-add notes: italic text and a grey circle, nothing else differs
  if (item.type === "sundry") {
    title = item.title;
    completed = item.completed;
    onCheck = () => onToggleSundry(item.id);
  } else if (task) {
    // "completedToday" is a local, always-visible checkmark separate from the task's real completion state —
    // this is what makes recurring chores (which immediately reset completed:false when done) still show as checked here.
    title = subtask ? subtask.title : task.title;
    completed = !!item.completedToday;
    onCheck = () => {
      if (subtask) onToggleAction(task.id, subtask.id);else onToggle(task);
      onToggleTodayTaskDone(item);
    };
  } else {
    title = "(removed)";
    completed = false;
    onCheck = () => {};
  }
  return /*#__PURE__*/<div style={{
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "6px 0",
    background: C.card
  }}>{startDrag && /*#__PURE__*/<DragHandle onPointerDown={startDrag} />}<button onClick={onCheck} style={{
      width: 18,
      height: 18,
      borderRadius: "50%",
      border: `2px solid ${isNote ? C.inkSoft : C.sage}`,
      background: completed ? isNote ? C.inkSoft : C.sage : "transparent",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      cursor: "pointer",
      color: C.white,
      fontSize: 10,
      flexShrink: 0
    }}>{completed && "✓"}</button><span onClick={task ? () => onEdit(task) : isNote && onConvertNote ? () => onConvertNote(item) : undefined} style={{
      flex: 1,
      fontSize: 13.5,
      color: C.ink,
      fontStyle: isNote ? "italic" : "normal",
      textDecoration: completed ? "line-through" : "none",
      cursor: task || isNote ? "pointer" : "default"
    }}>{title}</span><button onClick={onMove} style={{
      border: "none",
      background: "none",
      color: C.inkSoft,
      cursor: "pointer",
      fontSize: 10,
      padding: "0 2px",
      whiteSpace: "nowrap"
    }}>{moveLabel}</button><button onClick={() => item.type === "sundry" ? onDeleteSundry(item.id) : onRemoveTask(item.id, item.subtaskId)} style={{
      border: "none",
      background: "none",
      color: C.inkSoft,
      cursor: "pointer",
      fontSize: 12
    }}>×</button></div>;
}
function TodayPlanSection({
  items,
  tasksById,
  onAddSundry,
  onAddExisting,
  onToggleSundry,
  onDeleteSundry,
  onReorderBucketFull,
  onRemoveTask,
  onReset,
  onSetBucket,
  onToggle,
  onToggleAction,
  onEdit,
  onToggleTodayTaskDone,
  onConvertNote
}) {
  const [newSundry, setNewSundry] = useState("");
  const [resetting, setResetting] = useState(false);
  const candidates = useMemo(() => Object.values(tasksById).filter(t => !t.completed), [tasksById]);
  const similar = useMemo(() => findSimilarTasks(newSundry, candidates), [newSundry, candidates]);
  const inPlanIds = useMemo(() => new Set(items.filter(it => it.type === "task" && !it.subtaskId).map(it => it.id)), [items]);
  const commitSundry = () => {
    if (!newSundry.trim()) return;
    onAddSundry(newSundry.trim());
    setNewSundry("");
  };
  const useExisting = t => {
    if (!inPlanIds.has(t.id)) onAddExisting(t.id, null);
    setNewSundry("");
  };
  const nowItems = items.filter(it => it.bucket !== "later");
  const laterItems = items.filter(it => it.bucket === "later");
  const keyFn = item => item.type + item.id;
  return /*#__PURE__*/<div style={{
    background: C.card,
    border: `1px solid ${C.rule}`,
    borderRadius: 12,
    padding: "14px 14px 10px",
    marginBottom: 18,
    minHeight: "45vh",
    display: "flex",
    flexDirection: "column"
  }}><div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 10
    }}><div style={{
        fontFamily: "Fraunces, serif",
        fontSize: 16,
        color: C.ink
      }}>The plan</div>{!resetting ? /*#__PURE__*/<button onClick={() => setResetting(true)} style={{
        border: `1px solid ${C.plum}`,
        color: C.plum,
        background: "none",
        borderRadius: 8,
        padding: "4px 10px",
        fontSize: 10.5,
        fontWeight: 600,
        cursor: "pointer"
      }}>Reset</button> : /*#__PURE__*/<button onClick={() => {
        onReset();
        setResetting(false);
      }} style={{
        border: "none",
        color: C.white,
        background: C.plum,
        borderRadius: 8,
        padding: "4px 10px",
        fontSize: 10.5,
        fontWeight: 700,
        cursor: "pointer"
      }}>Confirm?</button>}</div><div style={{
      flex: 1
    }}>{nowItems.length === 0 && /*#__PURE__*/<div style={{
        color: C.inkSoft,
        fontSize: 12.5,
        textAlign: "center",
        padding: "6px 0 4px"
      }}>Nothing planned yet.</div>}<DragReorderList items={nowItems} keyFn={keyFn} onFinalize={arr => onReorderBucketFull("now", arr)} renderRow={(item, idx, startDrag) => /*#__PURE__*/<TodayItemRow item={item} tasksById={tasksById} onToggleSundry={onToggleSundry} onDeleteSundry={onDeleteSundry} onRemoveTask={onRemoveTask} onToggle={onToggle} onToggleAction={onToggleAction} onEdit={onEdit} onToggleTodayTaskDone={onToggleTodayTaskDone} onConvertNote={onConvertNote} onMove={() => onSetBucket(item, "later")} moveLabel="↓ Later" startDrag={startDrag} />} />{laterItems.length > 0 && /*#__PURE__*/<div style={{
        marginTop: 14,
        paddingTop: 10,
        borderTop: `1px dashed ${C.rule}`
      }}><div style={{
          fontSize: 10.5,
          color: C.inkSoft,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          marginBottom: 4
        }}>Later</div><DragReorderList items={laterItems} keyFn={keyFn} onFinalize={arr => onReorderBucketFull("later", arr)} renderRow={(item, idx, startDrag) => /*#__PURE__*/<TodayItemRow item={item} tasksById={tasksById} onToggleSundry={onToggleSundry} onDeleteSundry={onDeleteSundry} onRemoveTask={onRemoveTask} onToggle={onToggle} onToggleAction={onToggleAction} onEdit={onEdit} onToggleTodayTaskDone={onToggleTodayTaskDone} onConvertNote={onConvertNote} onMove={() => onSetBucket(item, "now")} moveLabel="↑ Today" startDrag={startDrag} />} /></div>}</div><div style={{
      marginTop: 14
    }}><div style={{
        display: "flex",
        gap: 6
      }}><input value={newSundry} onChange={e => {
          setNewSundry(capFirst(e.target.value));
        }} onKeyDown={e => {
          if (e.key === "Enter") commitSundry();
        }} onBlur={() => {
          if (!similar.length) commitSundry();
        }} placeholder="Quick add a task for today…" style={{
          ...inputStyle,
          fontSize: 13,
          background: C.white
        }} /><button onMouseDown={e => e.preventDefault()} onClick={commitSundry} style={{
          border: "none",
          background: C.sageDeep,
          color: C.white,
          borderRadius: 8,
          padding: "0 14px",
          cursor: "pointer"
        }}>+</button></div>{similar.length > 0 && /*#__PURE__*/<div style={{
        marginTop: 8,
        border: `1px solid ${C.rule}`,
        borderRadius: 8,
        background: C.white,
        overflow: "hidden"
      }}><div style={{
          fontSize: 11,
          color: C.inkSoft,
          padding: "6px 10px 2px"
        }}>Already on your list? Tap to add it to today:</div>{similar.map(t => /*#__PURE__*/<button key={t.id} onMouseDown={e => e.preventDefault()} onClick={() => useExisting(t)} disabled={inPlanIds.has(t.id)} style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          width: "100%",
          textAlign: "left",
          border: "none",
          borderTop: `1px solid ${C.rule}`,
          background: "none",
          padding: "9px 10px",
          cursor: inPlanIds.has(t.id) ? "default" : "pointer",
          opacity: inPlanIds.has(t.id) ? 0.5 : 1
        }}><span style={{
            fontSize: 13,
            color: C.ink,
            fontWeight: 600
          }}>{t.title}</span><span style={{
            fontSize: 11,
            color: C.inkSoft,
            flexShrink: 0
          }}>{inPlanIds.has(t.id) ? "On today's plan" : SECTION_LABELS[sectionForTask(t)]}</span></button>)}</div>}</div></div>;
}
/* landing screen for the All tasks tab: four full-page buttons, one per list */
function SectionIcon({ kind, size = 76 }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.25, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true };
  if (kind === "household") return /*#__PURE__*/<svg {...common}><path d="M20.5 3.5L13.2 10.8" /><path d="M10.6 9.6l3.8 3.8-3.1 5.9a1 1 0 0 1-1.6.3l-4.4-4.4a1 1 0 0 1 .3-1.6z" /><path d="M9.2 14.6l-2.3 3.4M11.8 16.1l-1.3 2.4" /></svg>;
  if (kind === "personalTasks") return /*#__PURE__*/<svg {...common}><circle cx="10" cy="8" r="3.2" /><path d="M4 20c0-3.5 2.7-6 6-6s6 2.5 6 6" /><path d="M16.5 6.5l1.8 1.8 3.2-3.6" /></svg>;
  if (kind === "shared") return /*#__PURE__*/<svg {...common}><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /><path d="M10 18l4-4" /><path d="M12.4 12.4l2.1-1 1.1 1.1-1 2.1z" /></svg>;
  return /*#__PURE__*/<svg {...common}><circle cx="10" cy="8" r="3.2" /><path d="M4 20c0-3.5 2.7-6 6-6s6 2.5 6 6" /><path d="M19 3l.9 1.9 2.1.3-1.5 1.5.4 2.1L19 7.8l-1.9 1 .4-2.1L16 5.2l2.1-.3z" /></svg>;
}
function TaskSections({ tasks, me, onOpen }) {
  const open = tasks.filter(t => !t.completed);
  const counts = { household: 0, personalTasks: 0, shared: 0, personal: 0 };
  open.forEach(t => {
    const k = sectionForTask(t);
    if ((k === "personalTasks" || k === "personal") && t.owner !== me) return;
    counts[k]++;
  });
  const keys = ["household", "personalTasks", "shared", "personal"];
  return /*#__PURE__*/<div style={{
    height: "calc(100% - 150px)",
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    boxSizing: "border-box",
    background: C.card
  }}>{keys.map(k => /*#__PURE__*/<button key={k} onClick={() => onOpen(k)} aria-label={SECTION_LABELS[k]} style={{
      position: "relative",
      flex: 1,
      minHeight: 0,
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      width: "100%",
      borderRadius: 16,
      border: `1px solid ${C.rule}`,
      background: C.white,
      color: C.ink,
      cursor: "pointer"
    }}><span style={{
        color: C.sageDeep,
        display: "flex"
      }}><SectionIcon kind={k} /></span><span style={{
        fontSize: 12,
        color: C.inkSoft,
        letterSpacing: 0.3
      }}>{SECTION_LABELS[k]}</span><span style={{
        position: "absolute",
        top: 10,
        right: 14,
        fontSize: 12,
        fontWeight: 700,
        color: C.inkSoft
      }}>{counts[k]}</span></button>)}</div>;
}
function QueueView(props) {
  const {
    tasks,
    me,
    filter,
    setFilter,
    choreFilter,
    setChoreFilter,
    projectFilter,
    setProjectFilter,
    config,
    onAddRoom,
    onAddCategory,
    onDeleteRoom,
    onDeleteCategory,
    onReorderRoomsFull,
    onReorderCategoriesFull,
    onToggle,
    onEdit,
    onDelete,
    onToggleAction,
    onAddAction,
    onDeleteAction,
    onReorderAction,
    onSetTaskActions,
    onSetActionDueDate,
    onToggleManualTodo,
    highlightTaskId,
    section,
    setSection
  } = props;
  const typeFilter = section === "household" || section === "personalTasks" ? "chore" : "project";
  const projectScope = section === "shared" ? "shared" : "personal";
  const typed = useMemo(() => tasks.filter(t => t.listType === typeFilter), [tasks, typeFilter]);
  const scoped = useMemo(() => {
    if (typeFilter === "chore") {
      if (section === "personalTasks") return typed.filter(t => t.scope === "personal" && t.owner === me);
      const sharedChores = typed.filter(t => t.scope !== "personal");
      if (choreFilter === "all") return sharedChores;
      return sharedChores.filter(t => t.assignee === choreFilter || !t.assignee);
    }
    if (typeFilter === "project") {
      let f = typed.filter(t => t.scope === projectScope);
      if (projectScope === "shared") {
        if (projectFilter !== "all") f = f.filter(t => t.assignee === projectFilter || !t.assignee);
      } else {
        f = f.filter(t => t.owner === me);
      }
      return f;
    }
    let f = typed;
    if (filter === "mine") f = f.filter(t => t.owner === me || t.scope === "shared" && (t.assignee === me || !t.assignee));
    if (filter === "shared") f = f.filter(t => t.scope === "shared");
    return f;
  }, [typed, typeFilter, choreFilter, projectScope, projectFilter, filter, me, section]);
  const sorted = useMemo(() => scoped.filter(t => !t.completed).slice().sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999")), [scoped]);
  const rowProps = {
    me,
    onToggle,
    onEdit,
    onDelete,
    onToggleAction,
    onAddAction,
    onDeleteAction,
    onReorderAction,
    onSetTaskActions,
    onSetActionDueDate,
    onToggleManualTodo
  };
  const catListForNav = projectScope === "shared" ? config.sharedCategories : config.personalCategories[me];
  const navSections = useMemo(() => {
    if (typeFilter === "chore") {
      const names = [...config.rooms, ...withOrphans(config.rooms, sorted, "room").slice(config.rooms.length)];
      return names.map(name => ({
        name,
        count: sorted.filter(t => (t.room || "Unassigned") === name).length
      }));
    }
    const names = [...catListForNav, ...withOrphans(catListForNav, sorted, "category").slice(catListForNav.length)];
    return names.map(name => ({
      name,
      count: sorted.filter(t => (t.category || "Unassigned") === name).length
    }));
  }, [typeFilter, config.rooms, catListForNav, sorted]);
  const [showNav, setShowNav] = useState(false);
  const [jumpToSection, setJumpToSection] = useState(null);
  useEffect(() => {
    if (!jumpToSection) return;
    const t = setTimeout(() => setJumpToSection(null), 4000);
    return () => clearTimeout(t);
  }, [jumpToSection]);
  if (!section) return /*#__PURE__*/<TaskSections tasks={tasks} me={me} onOpen={setSection} />;
  const sectionTitle = SECTION_LABELS[section];
  return /*#__PURE__*/<div style={{
    height: "calc(100% - 150px)",
    display: "flex",
    flexDirection: "column",
    background: C.card
  }}><div style={{
      background: C.card,
      borderBottom: `1px solid ${C.rule}`,
      paddingBottom: 10
    }}><div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 16px 0"
      }}><button onClick={() => setSection(null)} aria-label="Back to all tasks" style={{
          width: 38,
          padding: "6px 0",
          borderRadius: 8,
          border: `1px solid ${C.rule}`,
          background: C.white,
          color: C.ink,
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          flexShrink: 0
        }}>←</button><div style={{
          flex: 1,
          textAlign: "center",
          fontFamily: "Fraunces, serif",
          fontSize: 16,
          color: C.ink
        }}>{sectionTitle}</div><button onClick={() => setShowNav(true)} aria-label="Jump to a category" style={{
          width: 38,
          padding: "6px 0",
          borderRadius: 8,
          border: `1px solid ${C.rule}`,
          background: C.white,
          color: C.ink,
          fontSize: 14,
          cursor: "pointer",
          flexShrink: 0
        }}>☰</button></div>{section === "household" && /*#__PURE__*/<div style={{
        display: "flex",
        gap: 6,
        padding: "8px 16px 0"
      }}>{[["all", "All"], ["jade", "Jade"], ["john", "John"]].map(([k, l]) => /*#__PURE__*/<FilterChip key={k} active={choreFilter === k} onClick={() => setChoreFilter(k)} label={l} activeColor={filterColor(k)} activeTint={filterTint(k)} />)}</div>}{section === "shared" && /*#__PURE__*/<div style={{
        display: "flex",
        gap: 6,
        padding: "8px 16px 0"
      }}>{[["all", "All"], ["jade", "Jade"], ["john", "John"]].map(([k, l]) => /*#__PURE__*/<FilterChip key={k} active={projectFilter === k} onClick={() => setProjectFilter(k)} label={l} activeColor={filterColor(k)} activeTint={filterTint(k)} />)}</div>}</div>{typeFilter === "chore" ? /*#__PURE__*/<RoomBoard tasks={sorted} rowProps={rowProps} baseRooms={config.rooms} extraRooms={withOrphans(config.rooms, sorted, "room").slice(config.rooms.length)} onAddRoom={onAddRoom} onDeleteRoom={onDeleteRoom} onReorderRoomsFull={onReorderRoomsFull} colorBg={section === "personalTasks" ? filterColor(me) : filterColor(choreFilter)} highlightTaskId={highlightTaskId} jumpToSection={jumpToSection} /> : (() => {
      const catList = catListForNav;
      return /*#__PURE__*/<CategoryBoard tasks={sorted} rowProps={rowProps} baseCategories={catList} extraCategories={withOrphans(catList, sorted, "category").slice(catList.length)} onAddCategory={name => onAddCategory(projectScope, me, name)} onDeleteCategory={name => onDeleteCategory(projectScope, me, name)} onReorderCategoriesFull={newArr => onReorderCategoriesFull(projectScope, me, newArr)} colorBg={projectScope === "shared" ? filterColor(projectFilter) : filterColor(me)} highlightTaskId={highlightTaskId} jumpToSection={jumpToSection} />;
    })()}{showNav && /*#__PURE__*/<Overlay title={typeFilter === "chore" ? "Rooms" : "Categories"} onClose={() => setShowNav(false)}>{navSections.map(({
        name,
        count
      }) => /*#__PURE__*/<button key={name} onClick={() => {
        setJumpToSection(name);
        setShowNav(false);
      }} style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        width: "100%",
        textAlign: "left",
        border: "none",
        borderBottom: `1px solid ${C.rule}`,
        background: "none",
        padding: "13px 4px",
        cursor: "pointer"
      }}><span style={{
          fontSize: 14.5,
          color: C.ink,
          fontWeight: 600
        }}>{name}</span><span style={{
          fontSize: 12,
          color: C.inkSoft
        }}>{count}</span></button>)}</Overlay>}</div>;
}

/* horizontally scrolling row with tap-to-scroll arrows — helps when there are many sections */
/* two-tap inline confirm — avoids relying on window.confirm(), which can be unreliable in installed PWAs */
function SectionDeleteButton({
  onDelete
}) {
  const [confirming, setConfirming] = useState(false);
  if (confirming) {
    return /*#__PURE__*/<button onClick={e => {
      e.stopPropagation();
      onDelete();
    }} style={{
      border: "none",
      background: C.plum,
      color: C.white,
      borderRadius: 5,
      padding: "1px 7px",
      fontSize: 10,
      fontWeight: 700,
      cursor: "pointer",
      whiteSpace: "nowrap"
    }}>Confirm?</button>;
  }
  return /*#__PURE__*/<button onClick={e => {
    e.stopPropagation();
    setConfirming(true);
  }} style={{
    border: "none",
    background: "none",
    color: C.inkSoft,
    opacity: 0.7,
    cursor: "pointer",
    fontSize: 12,
    padding: 0
  }}>×</button>;
}
const PREVIEW_COUNT = 3;

/* Quiet header — a thin colour-coded stripe on a neutral card, instead of a full-bleed colour fill. Faded
   (not-yet-available) tasks are hidden by default, and a section with only faded tasks auto-collapses just
   like a genuinely empty one — "Show all" reveals both the rest of the list and any faded tasks. */
function StackedSection({
  name,
  tasks,
  colorBg,
  rowProps,
  onDelete,
  deletable,
  emptyLabel,
  dragHandle,
  highlightTaskId,
  jumpToSection,
  muted
}) {
  const todayStr = adelaideToday();
  const active = useMemo(() => tasks.filter(t => !isFadedTask(t, todayStr)), [tasks, todayStr]);
  const faded = useMemo(() => tasks.filter(t => isFadedTask(t, todayStr)), [tasks, todayStr]);
  const containsHighlight = highlightTaskId && tasks.some(t => t.id === highlightTaskId);
  const highlightIsFaded = containsHighlight && faded.some(t => t.id === highlightTaskId);
  const isJumpTarget = jumpToSection === name;
  const [collapsed, setCollapsed] = useState(() => active.length === 0);
  const [showFuture, setShowFuture] = useState(false);
  const userToggled = useRef(false);
  const sectionRef = useRef(null);
  useEffect(() => {
    if (!userToggled.current) setCollapsed(active.length === 0);
  }, [active.length === 0]);
  useEffect(() => {
    if (containsHighlight || isJumpTarget) {
      if (highlightIsFaded) setShowFuture(true);
      setCollapsed(false);
      const t = setTimeout(() => {
        if (sectionRef.current) sectionRef.current.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      }, 60);
      return () => clearTimeout(t);
    }
  }, [containsHighlight, highlightIsFaded, isJumpTarget]);
  const toggleHeader = () => {
    userToggled.current = true;
    setCollapsed(c => !c);
  };
  return /*#__PURE__*/<div style={{
    marginBottom: 16,
    opacity: muted ? 0.55 : 1
  }} ref={sectionRef}><div style={{
      display: "flex",
      alignItems: "center",
      gap: 4,
      background: "transparent",
      borderBottom: `1px solid ${isJumpTarget ? C.mustard : C.ink}`,
      boxShadow: isJumpTarget ? `0 2px 0 ${C.mustard}` : "none",
      padding: "6px 2px",
      marginBottom: 2
    }}><button onClick={toggleHeader} style={{
        flex: 1,
        textAlign: "left",
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 0,
        display: "flex",
        alignItems: "center",
        gap: 6
      }}><span style={{
          fontFamily: "Fraunces, serif",
          fontSize: 16,
          fontWeight: 600,
          color: C.ink
        }}>{name}</span><span style={{
          marginLeft: "auto",
          color: C.inkSoft,
          fontSize: 11
        }}>{collapsed ? "▸" : "▾"}</span></button>{deletable && /*#__PURE__*/<SectionDeleteButton onDelete={() => onDelete(name)} />}</div>{!collapsed && /*#__PURE__*/<div>{tasks.length === 0 && /*#__PURE__*/<div style={{
        color: C.inkSoft,
        fontSize: 12,
        textAlign: "center",
        padding: "10px 0"
      }}>{emptyLabel}</div>}{active.map(t => /*#__PURE__*/<TaskRow key={t.id} task={t} {...rowProps} compact={true} flat={true} highlighted={t.id === highlightTaskId} />)}{faded.length > 0 && !showFuture && /*#__PURE__*/<button onClick={() => setShowFuture(true)} style={{
        width: "100%",
        border: `1px dashed ${C.rule}`,
        background: "transparent",
        color: C.inkSoft,
        borderRadius: 8,
        padding: "6px 0",
        fontSize: 11.5,
        cursor: "pointer"
      }}>Show future tasks/chores ({faded.length}) →</button>}{showFuture && faded.map(t => /*#__PURE__*/<TaskRow key={t.id} task={t} {...rowProps} compact={true} flat={true} highlighted={t.id === highlightTaskId} />)}{showFuture && faded.length > 0 && /*#__PURE__*/<button onClick={() => setShowFuture(false)} style={{
        width: "100%",
        border: "none",
        background: "none",
        color: C.inkSoft,
        fontSize: 11.5,
        cursor: "pointer",
        padding: "4px 0"
      }}>Hide future tasks/chores ↑</button>}</div>}</div>;
}
function SectionStack({
  baseSections,
  extraSections,
  sectionTasksFn,
  colorBg,
  rowProps,
  onAdd,
  onDelete,
  onReorderFull,
  addLabel,
  emptyLabel,
  highlightTaskId,
  jumpToSection
}) {
  const todayStr = adelaideToday();
  // a section is "empty" when nothing in it is currently visible (postponed / not-yet-available tasks don't count)
  const hasVisible = name => sectionTasksFn(name).some(t => !isFadedTask(t, todayStr));
  const activeBase = baseSections.filter(hasVisible);
  const emptyBase = baseSections.filter(n => !hasVisible(n));
  const activeExtra = extraSections.filter(hasVisible);
  const emptyExtra = extraSections.filter(n => !hasVisible(n));
  // dragging reorders only the visible group; the new order is slotted back into the positions those sections held,
  // so empty sections keep their place in the saved order
  const finalizeActive = arr => {
    const activeSet = new Set(activeBase);
    let i = 0;
    onReorderFull(baseSections.map(n => activeSet.has(n) ? arr[i++] : n));
  };
  const hasEmpty = emptyBase.length + emptyExtra.length > 0;
  const common = {
    colorBg,
    rowProps,
    onDelete,
    emptyLabel,
    highlightTaskId,
    jumpToSection
  };
  return /*#__PURE__*/<div style={{
    padding: "12px 16px 90px",
    overflowY: "auto",
    flex: 1
  }}><DragReorderList items={activeBase} keyFn={name => name} onFinalize={finalizeActive} renderRow={(name, idx, startDrag) => /*#__PURE__*/<StackedSection name={name} tasks={sectionTasksFn(name)} {...common} deletable={true} dragHandle={/*#__PURE__*/<DragHandle onPointerDown={startDrag} />} />} />{activeExtra.map(name => /*#__PURE__*/<StackedSection key={name} name={name} tasks={sectionTasksFn(name)} {...common} deletable={name !== "Unassigned"} />)}{hasEmpty && /*#__PURE__*/<div style={{
      margin: "6px 0 10px",
      fontSize: 10.5,
      color: C.inkSoft,
      textTransform: "uppercase",
      letterSpacing: 0.6,
      fontWeight: 700,
      display: "flex",
      alignItems: "center",
      gap: 8
    }}><span>Nothing right now</span><span style={{
        flex: 1,
        height: 1,
        background: C.rule
      }} /></div>}{[...emptyBase, ...emptyExtra].map(name => /*#__PURE__*/<StackedSection key={name} name={name} tasks={sectionTasksFn(name)} {...common} muted={true} deletable={name !== "Unassigned"} />)}<AddSectionRow onAdd={onAdd} label={addLabel} /></div>;
}
function RoomBoard({
  tasks,
  rowProps,
  baseRooms,
  extraRooms,
  onAddRoom,
  onDeleteRoom,
  onReorderRoomsFull,
  colorBg,
  highlightTaskId,
  jumpToSection
}) {
  return /*#__PURE__*/<SectionStack baseSections={baseRooms} extraSections={extraRooms} sectionTasksFn={room => tasks.filter(t => (t.room || "Unassigned") === room)} colorBg={colorBg} rowProps={rowProps} onAdd={onAddRoom} onDelete={onDeleteRoom} onReorderFull={onReorderRoomsFull} addLabel="room" emptyLabel="No chores here" highlightTaskId={highlightTaskId} jumpToSection={jumpToSection} />;
}
function CategoryBoard({
  tasks,
  rowProps,
  baseCategories,
  extraCategories,
  onAddCategory,
  onDeleteCategory,
  onReorderCategoriesFull,
  colorBg,
  highlightTaskId,
  jumpToSection
}) {
  return /*#__PURE__*/<SectionStack baseSections={baseCategories} extraSections={extraCategories} sectionTasksFn={cat => tasks.filter(t => (t.category || "Unassigned") === cat)} colorBg={colorBg} rowProps={rowProps} onAdd={onAddCategory} onDelete={onDeleteCategory} onReorderFull={onReorderCategoriesFull} addLabel="category" emptyLabel="No projects here" highlightTaskId={highlightTaskId} jumpToSection={jumpToSection} />;
}
function AddSectionRow({
  onAdd,
  label
}) {
  const add = () => {
    const name = window.prompt(`New ${label} name`);
    if (name && name.trim()) onAdd(name.trim());
  };
  return /*#__PURE__*/<button onClick={add} style={{
    width: "100%",
    border: `1px dashed ${C.rule}`,
    background: "transparent",
    color: C.inkSoft,
    borderRadius: 8,
    padding: "10px 0",
    cursor: "pointer",
    fontSize: 12.5
  }}>+ Add section</button>;
}
function TaskRow({
  task,
  me,
  onToggle,
  onEdit,
  onDelete,
  onToggleAction,
  onAddAction,
  onDeleteAction,
  onReorderAction,
  onSetTaskActions,
  onSetActionDueDate,
  compact,
  onSnooze,
  onAddToToday,
  onRestore,
  onToggleManualTodo,
  highlighted,
  showAsCompleted,
  flat
}) {
  const [open, setOpen] = useState(false);
  const [newAction, setNewAction] = useState("");
  const imp = IMPORTANCE.find(x => x.key === task.priority) || null;
  const todayStr = adelaideToday();
  const isDone = task.completed || showAsCompleted;
  const overdue = task.dueDate && task.dueDate < todayStr && !isDone;
  const notYetAvailable = isFadedTask(task, todayStr);
  const na = nextAction(task);
  const progress = actionsProgress(task);
  const badgePerson = task.scope === "personal" ? task.owner : task.assignee;
  const commit = () => {
    if (newAction.trim()) {
      onAddAction(task.id, newAction);
      setNewAction("");
    }
  };
  const hasNotesToShow = !!(flat && task.notes);
  // flat (All tasks) look: overdue tasks get a soft pink wash instead of "N days ago" text — a little deeper once a week late
  const daysLate = overdue ? Math.round((new Date(todayStr + "T00:00:00") - new Date(task.dueDate + "T00:00:00")) / 86400000) : 0;
  const lateWash = !flat || !overdue ? "transparent" : daysLate >= 7 ? "rgba(214, 120, 140, 0.22)" : "rgba(214, 120, 140, 0.11)";
  // flat = the quiet All tasks look: no card, no box, just a hairline between tasks
  const rowStyle = flat ? {
    background: lateWash,
    border: "none",
    borderBottom: `1px solid ${C.rule}66`,
    boxShadow: highlighted ? `0 0 0 2px ${C.mustard}` : "none",
    borderRadius: highlighted || overdue ? 6 : 0,
    padding: "5px 4px",
    marginBottom: 0
  } : {
    background: C.card,
    border: `1px solid ${highlighted ? C.mustard : C.rule}`,
    boxShadow: highlighted ? `0 0 0 2px ${C.mustard}` : "none",
    borderRadius: 10,
    padding: compact ? "9px 10px" : "11px 12px",
    marginBottom: 8
  };
  return /*#__PURE__*/<div style={{
    ...rowStyle,
    opacity: isDone ? 0.55 : notYetAvailable ? 0.5 : 1
  }}><div style={{
      display: "flex",
      alignItems: "flex-start",
      gap: 10
    }}><button onClick={() => onToggle(task)} style={{
        width: 20,
        height: 20,
        borderRadius: "50%",
        border: `2px solid ${imp ? imp.color : C.inkSoft}`,
        background: isDone ? imp ? imp.color : C.inkSoft : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        flexShrink: 0,
        marginTop: 1,
        color: C.white,
        fontSize: 11
      }}>{isDone && "✓"}</button><div style={{
        flex: 1,
        minWidth: 0
      }} onClick={() => onEdit(task)}><div style={{
          display: "flex",
          alignItems: "center",
          gap: 6
        }}><div style={{
            fontSize: compact ? 13 : 14,
            color: C.ink,
            fontWeight: 600,
            textDecoration: isDone ? "line-through" : "none"
          }}>{task.title}</div>{task.needsDetails && /*#__PURE__*/<Tag color={C.inkSoft}>needs details</Tag>}</div>{!compact && /*#__PURE__*/<div style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginTop: 5,
          alignItems: "center"
        }}>{notYetAvailable && /*#__PURE__*/<Tag color={C.inkSoft}>Not yet — {fmtDate(task.dueDate)}</Tag>}{task.dueDate && !notYetAvailable && /*#__PURE__*/<span style={{
            fontSize: 10.5,
            fontFamily: "IBM Plex Mono, monospace",
            color: overdue ? C.plum : C.inkSoft,
            fontWeight: overdue ? 700 : 500
          }}>{fmtDate(task.dueDate)}</span>}</div>}{compact && !flat && task.dueDate && /*#__PURE__*/<div style={{
          fontSize: 10,
          fontFamily: "IBM Plex Mono, monospace",
          color: overdue && !flat ? C.plum : C.inkSoft,
          marginTop: 3
        }}>{notYetAvailable ? `Not yet — ${fmtDate(task.dueDate)}` : flat && overdue ? new Date(task.dueDate + "T00:00:00").toLocaleDateString("en-AU", {
            day: "numeric",
            month: "short"
          }) : fmtDate(task.dueDate)}</div>}</div><div style={{
        display: "flex",
        flexDirection: flat ? "row" : "column",
        gap: flat ? 8 : 4,
        alignItems: flat ? "center" : "stretch",
        flexShrink: 0
      }}>{badgePerson && /*#__PURE__*/<div style={{
          alignSelf: flat ? "center" : "flex-end"
        }}><PersonBadge person={badgePerson} size={18} /></div>}{onAddToToday && /*#__PURE__*/<button onClick={e => {
          e.stopPropagation();
          onAddToToday(task.id, null);
        }} style={{
          border: `1px solid ${C.rule}`,
          background: C.white,
          color: C.sageDeep,
          cursor: "pointer",
          padding: "2px 8px",
          fontSize: 11,
          fontWeight: 600,
          borderRadius: 6,
          whiteSpace: "nowrap"
        }}>+ The plan</button>}{onToggleManualTodo && /*#__PURE__*/<button onClick={e => {
          e.stopPropagation();
          onToggleManualTodo(task.id);
        }} style={{
          border: `1px solid ${task.manualTodo ? C.sage : C.rule}`,
          background: task.manualTodo ? "#E3EBDD" : C.white,
          color: C.sageDeep,
          cursor: "pointer",
          padding: "2px 8px",
          fontSize: 11,
          fontWeight: 600,
          borderRadius: 6,
          whiteSpace: "nowrap"
        }}>{task.manualTodo ? "− List" : "+ List"}</button>}{onRestore && /*#__PURE__*/<button onClick={e => {
          e.stopPropagation();
          onRestore();
        }} style={{
          border: `1px solid ${C.rule}`,
          background: C.white,
          color: C.sageDeep,
          cursor: "pointer",
          padding: "2px 8px",
          fontSize: 11,
          fontWeight: 600,
          borderRadius: 6,
          whiteSpace: "nowrap"
        }}>Restore</button>}</div></div>{task.notes && !compact && /*#__PURE__*/<div style={{
      marginLeft: 30,
      marginTop: 5,
      fontSize: 11.5,
      color: C.inkSoft,
      fontStyle: "italic"
    }}>{task.notes}</div>}{onSnooze && /*#__PURE__*/<div style={{
      marginLeft: 30,
      marginTop: 6
    }}><SnoozeControl onSnooze={onSnooze} /></div>}<div style={{
      marginLeft: 30,
      marginTop: 6
    }}>{na ? /*#__PURE__*/<button onClick={() => onToggleAction(task.id, na.id)} style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        border: "none",
        background: "none",
        padding: 0,
        cursor: "pointer",
        textAlign: "left"
      }}><span style={{
          width: 11,
          height: 11,
          borderRadius: "50%",
          border: `1.5px solid ${C.sageDeep}`,
          marginTop: 2,
          flexShrink: 0
        }} /><span style={{
          fontSize: compact ? 11 : 12,
          color: C.sageDeep,
          fontStyle: "italic",
          lineHeight: 1.3
        }}>Next: {na.title}{na.dueDate ? ` · ${fmtDate(na.dueDate)}` : ""}</span></button> : progress ? /*#__PURE__*/<span style={{
        fontSize: 11,
        color: C.inkSoft
      }}>All subtasks done</span> : null}{(flat ? hasNotesToShow : progress || hasNotesToShow) && /*#__PURE__*/<button onClick={() => setOpen(o => !o)} style={{
        border: "none",
        background: "none",
        color: C.inkSoft,
        fontSize: 10.5,
        cursor: "pointer",
        padding: 0,
        marginLeft: na ? 8 : 0
      }}>{flat ? "notes" : progress || "notes"} {open ? "▴" : "▾"}</button>}</div>{open && /*#__PURE__*/<div style={{
      marginLeft: 30,
      marginTop: 8,
      borderTop: flat ? "none" : `1px dashed ${C.rule}`,
      paddingTop: flat ? 2 : 8
    }}>{hasNotesToShow && /*#__PURE__*/<div style={{
        fontSize: 12,
        color: C.inkSoft,
        fontStyle: "italic",
        marginBottom: 8,
        whiteSpace: "pre-wrap"
      }}>{task.notes}</div>}<DragReorderList items={task.actions || []} keyFn={a => a.id} onFinalize={arr => onSetTaskActions(task.id, arr)} renderRow={(a, idx, startDrag) => /*#__PURE__*/<div style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        marginBottom: 6,
        flexWrap: "wrap",
        background: flat ? "transparent" : C.card
      }}><DragHandle onPointerDown={startDrag} /><button onClick={() => onToggleAction(task.id, a.id)} style={{
          width: 15,
          height: 15,
          borderRadius: 4,
          border: `1.5px solid ${C.sageDeep}`,
          background: a.completed ? C.sageDeep : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
          color: C.white,
          fontSize: 9
        }}>{a.completed && "✓"}</button><span style={{
          fontSize: 12,
          color: C.ink,
          textDecoration: a.completed ? "line-through" : "none",
          flex: 1,
          minWidth: 60
        }}>{a.title}</span><input type="date" value={a.dueDate || ""} onChange={e => onSetActionDueDate(task.id, a.id, e.target.value)} style={{
          fontSize: 10,
          border: `1px solid ${C.rule}`,
          borderRadius: 5,
          padding: "2px 4px",
          color: C.inkSoft,
          width: 108
        }} /><button onClick={() => onDeleteAction(task.id, a.id)} style={{
          border: "none",
          background: "none",
          color: C.inkSoft,
          cursor: "pointer",
          padding: 0,
          fontSize: 12
        }}>×</button></div>} /><div style={{
        display: "flex",
        gap: 6,
        marginTop: 4
      }}><input value={newAction} onChange={e => setNewAction(capFirst(e.target.value))} onKeyDown={e => {
          if (e.key === "Enter") commit();
        }} onBlur={commit} placeholder="Add a subtask…" style={{
          ...inputStyle,
          padding: "6px 9px",
          fontSize: 12
        }} /><button onClick={commit} style={{
          border: "none",
          background: C.sageDeep,
          color: C.white,
          borderRadius: 6,
          padding: "0 10px",
          cursor: "pointer"
        }}>+</button></div></div>}</div>;
}
function Tag({
  color,
  children
}) {
  return /*#__PURE__*/<span style={{
    fontSize: 10,
    color: C.white,
    background: color,
    padding: "2px 7px",
    borderRadius: 20,
    display: "inline-flex",
    alignItems: "center"
  }}>{children}</span>;
}
function MetaTag({
  children
}) {
  return /*#__PURE__*/<span style={{
    fontSize: 10,
    color: C.inkSoft,
    background: "#EAE4D6",
    padding: "2px 7px",
    borderRadius: 20,
    display: "inline-flex",
    alignItems: "center"
  }}>{children}</span>;
}

/* Drag handle — press and drag vertically to reorder. Works with mouse and touch via Pointer Events. */
function DragHandle({
  onPointerDown,
  light
}) {
  return /*#__PURE__*/<div onPointerDown={onPointerDown} style={{
    cursor: "grab",
    padding: "2px 7px",
    color: light ? "rgba(255,255,255,0.75)" : C.inkSoft,
    fontSize: 15,
    touchAction: "none",
    userSelect: "none",
    lineHeight: 1,
    flexShrink: 0
  }}>⠿</div>;
}

/* Generic vertical drag-to-reorder list. Reorders locally (for instant visual feedback) while dragging,
   and commits once via onFinalize(newOrderArray) on release — never writes mid-drag. */
function DragReorderList({
  items,
  keyFn,
  onFinalize,
  renderRow
}) {
  const [order, setOrder] = useState(items);
  const [dragging, setDragging] = useState(null); // { index, offsetY, height }
  const containerRef = useRef(null);
  const orderRef = useRef(items);
  orderRef.current = order;
  useEffect(() => {
    if (!dragging) setOrder(items);
  }, [items]); // eslint-disable-line

  const startDrag = index => e => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const container = containerRef.current;
    const rows = container ? Array.from(container.children) : [];
    const height = (rows[index] ? rows[index].getBoundingClientRect().height : 44) + 8;
    const startY = e.clientY;
    setDragging({
      index,
      offsetY: 0,
      height
    });
    const onMove = ev => {
      setDragging(d => d ? {
        ...d,
        offsetY: ev.clientY - startY
      } : d);
    };
    const onEnd = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onEnd);
      setDragging(d => {
        if (!d) return null;
        const shift = Math.round(d.offsetY / d.height);
        const from = d.index;
        const to = Math.max(0, Math.min(orderRef.current.length - 1, from + shift));
        if (to !== from) {
          const arr = orderRef.current.slice();
          const [moved] = arr.splice(from, 1);
          arr.splice(to, 0, moved);
          setOrder(arr);
          onFinalize(arr);
        }
        return null;
      });
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onEnd);
  };
  return /*#__PURE__*/<div ref={containerRef}>{order.map((item, index) => {
      const isDragging = dragging && dragging.index === index;
      const style = isDragging ? {
        transform: `translateY(${dragging.offsetY}px)`,
        position: "relative",
        zIndex: 5,
        opacity: 0.94,
        boxShadow: "0 6px 16px rgba(43,42,40,0.18)"
      } : {};
      return /*#__PURE__*/<div key={keyFn(item)} style={style}>{renderRow(item, index, startDrag(index))}</div>;
    })}</div>;
}

/* matches the plain Chores/Projects section heading style, but collapsible (closed by default) */
function CollapsibleSection({
  title,
  count,
  defaultOpen,
  collapsedAll,
  children
}) {
  const [open, setOpen] = useState(!collapsedAll && !!defaultOpen);
  // the Collapse all / Expand all switch resets every section: collapsed = all closed, expanded = back to each one's own default
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    setOpen(!collapsedAll && !!defaultOpen);
  }, [collapsedAll]);
  return /*#__PURE__*/<div style={{
    marginBottom: 14
  }}><button onClick={() => setOpen(o => !o)} style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      width: "100%",
      background: "none",
      border: "none",
      padding: 0,
      cursor: "pointer",
      marginBottom: open ? 6 : 0
    }}><span style={{
        fontSize: 12.5,
        color: C.inkSoft,
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: 0.5
      }}>{title}{count != null ? ` (${count})` : ""}</span><span style={{
        color: C.inkSoft,
        fontSize: 10
      }}>{open ? "▴" : "▾"}</span></button>{open && children}</div>;
}

/* ---------- overlay ---------- */
function Overlay({
  title,
  onClose,
  headerExtra,
  children
}) {
  return /*#__PURE__*/<div style={{
    position: "absolute",
    inset: 0,
    background: "rgba(43,42,40,0.4)",
    display: "flex",
    alignItems: "flex-end",
    zIndex: 10
  }} onClick={onClose}><div style={{
      background: C.parchment,
      width: "100%",
      maxHeight: "80%",
      borderRadius: "18px 18px 0 0",
      display: "flex",
      flexDirection: "column",
      overflow: "hidden"
    }} onClick={e => e.stopPropagation()}><div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "18px 18px 14px",
        borderBottom: `1px solid ${C.rule}`,
        flexShrink: 0
      }}><div style={{
          fontFamily: "Fraunces, serif",
          fontSize: 18,
          fontWeight: 600,
          color: C.ink
        }}>{title}</div><div style={{
          display: "flex",
          alignItems: "center",
          gap: 12
        }}>{headerExtra}<button onClick={onClose} style={{
            border: "none",
            background: "none",
            cursor: "pointer",
            color: C.inkSoft,
            fontSize: 20
          }}>×</button></div></div><div style={{
        overflowY: "auto",
        overflowX: "hidden",
        padding: 18,
        flex: 1
      }}>{children}</div></div></div>;
}

/* ---------- reusable section (room/category) picker with inline "add new" ---------- */
function SectionSelect({
  value,
  onChange,
  options,
  onAddNew
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const commit = () => {
    if (name.trim()) {
      onAddNew(name.trim());
      onChange(name.trim());
    }
    setAdding(false);
    setName("");
  };
  if (adding) {
    return /*#__PURE__*/<div style={{
      display: "flex",
      gap: 6
    }}><input autoFocus={true} autoComplete="off" value={name} onChange={e => setName(capFirst(e.target.value))} placeholder="New section name" style={inputStyle} onKeyDown={e => {
        if (e.key === "Enter") commit();
      }} onBlur={commit} /><button onClick={commit} style={{
        border: "none",
        background: C.sageDeep,
        color: C.white,
        borderRadius: 8,
        padding: "0 12px",
        cursor: "pointer"
      }}>Add</button></div>;
  }
  return /*#__PURE__*/<select value={value} onChange={e => {
    if (e.target.value === "__new__") setAdding(true);else onChange(e.target.value);
  }} style={inputStyle}>{(value && !options.includes(value) ? [value, ...options] : options).map(o => /*#__PURE__*/<option key={o} value={o}>{o}</option>)}<option value="__new__">+ Add new…</option></select>;
}
function TaskForm({
  me,
  initial,
  prefillTitle,
  config,
  onAddRoom,
  onAddCategory,
  onClose,
  onSave,
  onDelete
}) {
  const [t, setT] = useState(() => {
    const base = initial || {
      id: uid(),
      title: prefillTitle || "",
      listType: null,
      scope: null,
      owner: me,
      room: "Unassigned",
      category: "Unassigned",
      assignee: null,
      priority: null,
      priorityBucket: null,
      dueDate: null,
      recurrence: {
        unit: "none",
        amount: 1,
        mode: "rolling"
      },
      notes: "",
      completed: false,
      gridBucket: {},
      actions: [],
      needsDetails: false,
      createdBy: me,
      startsOnDue: false,
      createdAt: Date.now(),
      completedAt: null
    };
    return {
      ...base,
      recurrence: normRecurrence(base.recurrence)
    };
  });
  const [deferDetails, setDeferDetails] = useState(false);
  // A "add details later" task is saved with default Type/Belongs to, so we can't tell from the values whether
  // they've been properly chosen yet — track whether the user has actually set both.
  const [touched, setTouched] = useState({});
  const set = (k, v) => {
    if (k === "listType" || k === "scope") setTouched(p => ({ ...p, [k]: true }));
    setT(p => ({
      ...p,
      [k]: v
    }));
  };
  const [newAction, setNewAction] = useState("");
  const addFormAction = () => {
    if (!newAction.trim()) return;
    set("actions", [...(t.actions || []), {
      id: uid(),
      title: newAction.trim(),
      completed: false,
      dueDate: null
    }]);
    setNewAction("");
  };
  const removeFormAction = id => set("actions", (t.actions || []).filter(a => a.id !== id));
  const toggleFormAction = id => set("actions", (t.actions || []).map(a => a.id === id ? {
    ...a,
    completed: !a.completed
  } : a));
  const setFormActionDate = (id, date) => set("actions", (t.actions || []).map(a => a.id === id ? {
    ...a,
    dueDate: date || null
  } : a));
  const categoryOptions = ["Unassigned", ...(t.scope === "shared" ? config.sharedCategories : config.personalCategories[t.owner || me])];
  const roomOptions = ["Unassigned", ...config.rooms];
  const showAssignee = t.scope === "shared";
  const [detailsOpen, setDetailsOpen] = useState(false);
  const typeValue = t.listType && t.scope ? sectionForTask(t) : null;
  const chooseType = k => {
    const listType = k === "household" || k === "personalTasks" ? "chore" : "project";
    const scope = k === "household" || k === "shared" ? "shared" : "personal";
    set("listType", listType);
    set("scope", scope);
    if (scope === "personal") set("assignee", null); // assigning only applies to shared tasks
  };
  // a pinned project that moves out of its current Priorities row (to a chore, or between shared/personal) loses its pin
  const hadPin = !!(initial && initial.listType === "project" && initial.gridBucket && Object.values(initial.gridBucket).some(Boolean));
  const willUnpin = hadPin && !deferDetails && !!typeValue && (t.listType !== "project" || t.scope !== initial.scope);
  const typeTiles = /*#__PURE__*/<div style={{
      marginBottom: 14
    }}><div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 8
      }}>{TYPE_CHOICES.map(([k, label]) => {
          const active = typeValue === k;
          return /*#__PURE__*/<button key={k} onClick={() => chooseType(k)} aria-label={label} style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 5,
            padding: "12px 6px 10px",
            borderRadius: 12,
            border: `1px solid ${active ? C.ink : C.rule}`,
            background: active ? C.ink : C.white,
            color: active ? C.white : C.sageDeep,
            cursor: "pointer"
          }}><SectionIcon kind={k} size={34} /><span style={{
              fontSize: 12,
              fontWeight: 600,
              color: active ? C.white : C.ink
            }}>{label}</span></button>;
        })}</div>{willUnpin && /*#__PURE__*/<div style={{
        fontSize: 12,
        color: C.plum,
        marginTop: 9
      }}>Changing this will unpin it from Priorities.</div>}</div>;
  const recurText = t.recurrence.unit === "none" ? "Doesn't repeat" : `Repeats every ${t.recurrence.amount > 1 ? t.recurrence.amount + " " : ""}${t.recurrence.unit}${t.recurrence.amount > 1 ? "s" : ""}`;
  const placeName = deferDetails ? null : t.listType === "chore" ? t.room : t.listType === "project" ? t.category : null;
  const impLabel = (IMPORTANCE.find(p => p.key === t.priority) || {}).label;
  const detailsSummary = [placeName && placeName !== "Unassigned" ? placeName : null, impLabel ? `${impLabel} importance` : null, recurText].filter(Boolean).join(" · ");
  // Title, and (Type + Belongs to) unless explicitly deferred — these have no safe default to silently fall back on
  const isValid = t.title.trim() && (deferDetails || !!t.listType && !!t.scope);
  const finishAndSave = () => {
    const finalActions = newAction.trim() ? [...(t.actions || []), {
      id: uid(),
      title: newAction.trim(),
      completed: false,
      dueDate: null
    }] : t.actions || [];
    const detailsOk = deferDetails || !!t.listType && !!t.scope;
    if (t.title.trim() && detailsOk) {
      onSave({
        ...t,
        actions: finalActions,
        listType: t.listType || "chore",
        scope: t.scope || "shared",
        owner: t.scope === "personal" ? t.owner || me : null,
        needsDetails: initial && initial.needsDetails ? !(touched.listType && touched.scope) : deferDetails,
        ...(willUnpin ? { gridBucket: {} } : {}),
        createdBy: t.createdBy || me
      });
    } else {
      onClose();
    }
  };
  return /*#__PURE__*/<Overlay title={initial ? "Edit task" : "New task"} onClose={finishAndSave} headerExtra={/*#__PURE__*/<React.Fragment><button disabled={!isValid} onClick={finishAndSave} style={{
      background: isValid ? C.ink : C.rule,
      color: C.white,
      border: "none",
      borderRadius: 20,
      padding: "7px 16px",
      fontSize: 13,
      fontWeight: 700,
      cursor: isValid ? "pointer" : "default"
    }}>Save</button></React.Fragment>}><FormSection first={true}><div style={{
        marginBottom: 16
      }}><input value={t.title} onChange={e => set("title", capFirst(e.target.value))} placeholder="Task title" aria-label="Task title" style={{
          width: "100%",
          boxSizing: "border-box",
          border: "none",
          borderBottom: `1.5px dashed ${C.rule}`,
          borderRadius: 0,
          background: "transparent",
          outline: "none",
          padding: "4px 0 7px",
          fontFamily: "Fraunces, serif",
          fontSize: 23,
          fontWeight: 600,
          color: C.ink
        }} /></div>{!initial && /*#__PURE__*/<label htmlFor="defer-details" style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        marginBottom: 14,
        fontSize: 12,
        color: C.inkSoft,
        cursor: "pointer"
      }}><input type="checkbox" id="defer-details" checked={deferDetails} onChange={e => setDeferDetails(e.target.checked)} />Add details later</label>}<Field label="Due date"><div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap"
        }}><input type="date" value={t.dueDate || ""} onChange={e => set("dueDate", e.target.value || null)} style={{
            ...inputStyle,
            width: 160,
            flexShrink: 0
          }} />{t.dueDate && /*#__PURE__*/<label htmlFor="starts-on-due" style={{
            display: "flex",
            alignItems: "center",
            gap: 7,
            fontSize: 12,
            color: C.inkSoft,
            lineHeight: 1.3,
            cursor: "pointer"
          }}><input type="checkbox" id="starts-on-due" checked={!!t.startsOnDue} onChange={e => set("startsOnDue", e.target.checked)} />Due date is do date</label>}</div></Field><Field label="Subtasks"><DragReorderList items={t.actions || []} keyFn={a => a.id} onFinalize={arr => set("actions", arr)} renderRow={(a, idx, startDrag) => /*#__PURE__*/<div style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          marginBottom: 7,
          flexWrap: "wrap",
          background: C.white
        }}><DragHandle onPointerDown={startDrag} /><button onClick={() => toggleFormAction(a.id)} style={{
            width: 15,
            height: 15,
            borderRadius: 4,
            border: `1.5px solid ${C.sageDeep}`,
            background: a.completed ? C.sageDeep : "transparent",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
            color: C.white,
            fontSize: 9
          }}>{a.completed && "✓"}</button><span style={{
            fontSize: 13,
            color: C.ink,
            flex: 1,
            minWidth: 60,
            textDecoration: a.completed ? "line-through" : "none"
          }}>{a.title}</span><input type="date" value={a.dueDate || ""} onChange={e => setFormActionDate(a.id, e.target.value)} style={{
            fontSize: 10,
            border: `1px solid ${C.rule}`,
            borderRadius: 5,
            padding: "3px 5px",
            color: C.inkSoft,
            width: 112
          }} /><button onClick={() => removeFormAction(a.id)} style={{
            border: "none",
            background: "none",
            color: C.inkSoft,
            cursor: "pointer"
          }}>×</button></div>} /><div style={{
          display: "flex",
          gap: 6
        }}><input value={newAction} onChange={e => setNewAction(capFirst(e.target.value))} onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              addFormAction();
            }
          }} onBlur={addFormAction} placeholder="e.g. Buy grout" style={{
            ...inputStyle,
            fontSize: 13
          }} /><button onClick={addFormAction} style={{
            border: "none",
            background: C.sageDeep,
            color: C.white,
            borderRadius: 8,
            padding: "0 12px",
            cursor: "pointer"
          }}>+</button></div></Field></FormSection><FormSection title="Notes"><textarea value={t.notes || ""} onChange={e => set("notes", e.target.value)} rows={3} placeholder="Add notes…" aria-label="Notes" style={{
        ...inputStyle,
        resize: "vertical",
        fontFamily: "inherit"
      }} /></FormSection>{!initial && !deferDetails && /*#__PURE__*/<FormSection title="Type">{typeTiles}</FormSection>}<div style={{
      marginTop: 16,
      paddingTop: 14,
      borderTop: `1px solid ${C.rule}`
    }}><div style={{
        display: "flex",
        alignItems: "center",
        gap: 10
      }}><button onClick={() => setDetailsOpen(o => !o)} aria-expanded={detailsOpen} style={{
          padding: "8px 14px",
          borderRadius: 10,
          border: `1px solid ${C.ink}`,
          background: detailsOpen ? C.ink : C.white,
          color: detailsOpen ? C.white : C.ink,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          flexShrink: 0
        }}>Details {detailsOpen ? "▴" : "▾"}</button><span style={{
          fontSize: 12,
          color: C.inkSoft,
          lineHeight: 1.35,
          minWidth: 0
        }}>{detailsSummary}</span></div>{detailsOpen && /*#__PURE__*/<div style={{
        marginTop: 16
      }}>{initial && !deferDetails && typeTiles}{!deferDetails && showAssignee && /*#__PURE__*/<SelectField label="Assign to" value={t.assignee} onChange={v => set("assignee", v)} options={[[null, "Anyone"], ["jade", "Jade"], ["john", "John"]]} />}{!deferDetails && t.listType === "chore" && /*#__PURE__*/<Field label="Room"><SectionSelect value={t.room} onChange={v => set("room", v)} options={roomOptions} onAddNew={onAddRoom} /></Field>}{!deferDetails && t.listType === "project" && t.scope && /*#__PURE__*/<Field label="Category"><SectionSelect value={t.category} onChange={v => set("category", v)} options={categoryOptions} onAddNew={name => onAddCategory(t.scope, t.owner || me, name)} /></Field>}<SelectField label="Importance" value={t.priority} onChange={v => set("priority", v)} options={[[null, "None"], ...IMPORTANCE.map(p => [p.key, p.label])]} />{t.listType === "project" && /*#__PURE__*/<SelectField label="Priority category (doesn't pin automatically)" value={t.priorityBucket} onChange={v => set("priorityBucket", v)} options={[[null, "None"], ...BUCKETS.map(b => [b.key, b.label])]} />}<SelectField label="Repeats" value={t.recurrence.unit} onChange={v => set("recurrence", {
            ...t.recurrence,
            unit: v
          })} options={RECUR_UNITS} />{t.recurrence.unit !== "none" && /*#__PURE__*/<React.Fragment><Field label={`Every (${t.recurrence.unit}s)`}><input type="number" min="1" value={t.recurrence.amount} onChange={e => set("recurrence", {
              ...t.recurrence,
              amount: Math.max(1, parseInt(e.target.value, 10) || 1)
            })} style={{
              ...inputStyle,
              width: 90
            }} /></Field><SelectField label="When completed" value={t.recurrence.mode} onChange={v => set("recurrence", {
              ...t.recurrence,
              mode: v
            })} options={[["rolling", "Restart timer from completion"], ["fixed", "Stick to the schedule"]]} /></React.Fragment>}</div>}</div>{initial && /*#__PURE__*/<button onClick={() => {
      if (window.confirm(`Delete "${t.title}"? This can't be undone.`)) onDelete(t.id);
    }} style={{
      width: "100%",
      marginTop: 8,
      padding: "10px 0",
      borderRadius: 10,
      border: `1px solid ${C.plum}`,
      background: "transparent",
      color: C.plum,
      fontSize: 13.5,
      fontWeight: 600,
      cursor: "pointer"
    }}>Delete task</button>}</Overlay>;
}
function SelectField({ label, value, onChange, options }) {
  return /*#__PURE__*/<Field label={label}><select value={value === null || value === undefined ? "" : String(value)} onChange={e => {
      const raw = e.target.value;
      const match = options.find(([v]) => String(v === null ? "" : v) === raw);
      onChange(match ? match[0] : null);
    }} style={{
      ...inputStyle,
      appearance: "auto"
    }}>{options.map(([v, l]) => /*#__PURE__*/<option key={String(v)} value={v === null ? "" : String(v)}>{l}</option>)}</select></Field>;
}
function FormSection({
  title,
  first,
  children
}) {
  return /*#__PURE__*/<div style={{
    marginTop: first ? 0 : 18,
    paddingTop: first ? 0 : 16,
    borderTop: first ? "none" : `1px solid ${C.rule}`
  }}>{title && /*#__PURE__*/<div style={{
      fontFamily: "Fraunces, serif",
      fontSize: 13,
      fontWeight: 600,
      color: C.sageDeep,
      marginBottom: 11
    }}>{title}</div>}{children}</div>;
}
function Field({
  label,
  children
}) {
  return /*#__PURE__*/<div style={{
    marginBottom: 13
  }}><div style={{
      fontSize: 11,
      color: C.inkSoft,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginBottom: 5
    }}>{label}</div>{children}</div>;
}
const inputStyle = {
  width: "100%",
  padding: "10px 11px",
  borderRadius: 8,
  border: `1px solid ${C.rule}`,
  background: C.white,
  fontSize: 14,
  color: C.ink,
  outline: "none",
  boxSizing: "border-box"
};
function SegRow({
  options,
  value,
  onChange
}) {
  return /*#__PURE__*/<div style={{
    display: "flex",
    gap: 6,
    flexWrap: "wrap"
  }}>{options.map(([val, label]) => /*#__PURE__*/<button key={String(val)} onClick={() => onChange(val)} style={{
      padding: "7px 13px",
      borderRadius: 8,
      border: `1px solid ${value === val ? C.ink : C.rule}`,
      background: value === val ? C.ink : C.white,
      color: value === val ? C.white : C.ink,
      fontSize: 12.5,
      cursor: "pointer"
    }}>{label}</button>)}</div>;
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/<App />);