// Alleen voor lokaal testen: een nagebootste vibers-omgeving op localhost.
// Op vibers zelf doet dit bestand niets.
(function () {
  if (location.hostname !== "localhost" && location.hostname !== "127.0.0.1") return;
  if (window.vibers) return;

  const params = new URLSearchParams(location.search);
  const ik = {
    email: params.get("als") || "bram.serpieters@o2o.be",
    name: params.get("naam") || "Bram Serpieters",
    picture: null,
  };
  const lees = (k) => JSON.parse(localStorage.getItem("stub:" + k) || "null");
  const schrijf = (k, v) => localStorage.setItem("stub:" + k, JSON.stringify(v));
  const pauze = () => new Promise((r) => setTimeout(r, 30));

  function collection(naam) {
    const sleutel = "col:" + naam;
    const alle = () => lees(sleutel) || {};
    const metMine = (d) => ({ ...d, mine: d.createdBy?.email === ik.email });
    return {
      async create(data) {
        await pauze();
        const nu = new Date().toISOString();
        const doc = { ...data, id: Math.random().toString(36).slice(2), createdAt: nu, updatedAt: nu, createdBy: { email: ik.email, name: ik.name }, updatedBy: { email: ik.email, name: ik.name } };
        schrijf(sleutel, { ...alle(), [doc.id]: doc });
        return metMine(doc);
      },
      async get(id) { await pauze(); const d = alle()[id]; return d ? metMine(d) : null; },
      async update(id, patch) {
        await pauze();
        const a = alle();
        if (!a[id]) throw Object.assign(new Error("not found"), { code: "not_found" });
        a[id] = { ...a[id], ...patch, updatedAt: new Date().toISOString(), updatedBy: { email: ik.email, name: ik.name } };
        schrijf(sleutel, a);
        return metMine(a[id]);
      },
      async delete(id) { await pauze(); const a = alle(); const had = !!a[id]; delete a[id]; schrijf(sleutel, a); return had; },
      async find(q = {}) {
        await pauze();
        let items = Object.values(alle()).map(metMine);
        if (q.mine) items = items.filter((d) => d.mine);
        for (const [k, v] of Object.entries(q.where || {})) items = items.filter((d) => (d[k] ?? null) === v);
        return { items, nextCursor: null, changesCursor: "stub" };
      },
      subscribe() { return () => {}; },
    };
  }

  const storage = {
    async get(key, shared) { await pauze(); const v = lees((shared ? "deel:" : "eigen:") + key); return v == null ? null : { key, value: v, shared: !!shared, updatedBy: null }; },
    async set(key, value, shared) { await pauze(); schrijf((shared ? "deel:" : "eigen:") + key, value); return { key, value, shared: !!shared }; },
    async delete(key, shared) { await pauze(); localStorage.removeItem("stub:" + (shared ? "deel:" : "eigen:") + key); return { key, deleted: true, shared: !!shared }; },
    async list() { return { keys: [], prefix: "", shared: false, changesCursor: "stub" }; },
  };

  window.storage = storage;
  window.vibers = {
    me: async () => ik,
    people: { list: async () => [ik], get: async () => ik, search: async () => [ik] },
    db: { collection },
    storage: { subscribe() { return () => {}; } },
  };
  console.info("vibers-stub actief als", ik.email);
})();
