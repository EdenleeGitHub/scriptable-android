/* JSON-backed Android script records exposed as ordinary .js files in app storage.
 * The repository is authoritative at run start. File writes must settle before
 * their associated library mutation; the core ordered persistence queue enforces this.
 */
(() => {
  'use strict';
  const R = self.__runtime, FM = self.FileManager;
  const scripts = R.context.scripts ||= [];
  const validName = name => typeof name === 'string' && name.length > 0 && name.length <= 120 && !/[\\/\0\r\n]/.test(name) && name !== '.' && name !== '..';
  const alias = script => validName(script.name) ? '/documents/' + script.name + '.js' : null;
  const normalize = path => FM.local().joinPath('/', path);
  const scriptAt = path => {
    const id = R.files[path]?._scriptId;
    return id ? scripts.find(script => script.id === id) : null;
  };
  const destinationName = path => {
    const match = /^\/documents\/([^/]+)\.js$/.exec(path);
    return match && validName(match[1]) ? match[1] : null;
  };
  const timestamp = script => Number(script.updatedAt) || Date.now();
  for (const script of scripts) {
    const path = alias(script); if (!path || typeof script.code !== 'string') continue;
    if (R.files[path]?._scriptId && script.id !== R.context.script?.id) continue;
    R.files[path] = { type: 'file', text: script.code, modifiedAt: timestamp(script), createdAt: Number(script.createdAt) || timestamp(script), _scriptId: script.id };
  }
  function replace(record) {
    const index = scripts.findIndex(script => script.id === record.id);
    if (index < 0) scripts.push(record); else scripts[index] = record;
  }
  function save(record, path) {
    const next = { ...record, code: FM.local().readString(path), updatedAt: Date.now() };
    replace(next); R.files[path]._scriptId = next.id;
    R.persist('repo.save', { id: next.id, name: next.name, code: next.code, color: next.color || '#4C7CF3', icon: next.icon || 'code' });
  }
  function removeRecord(record) {
    const index = scripts.findIndex(script => script.id === record.id); if (index >= 0) scripts.splice(index, 1);
    R.persist('repo.delete', { id: record.id });
  }
  for (const method of ['writeString', 'write']) {
    const original = FM.prototype[method];
    FM.prototype[method] = function (path, value) {
      path = normalize(path); const record = scriptAt(path), created = R.files[path]?.createdAt;
      const result = original.call(this, path, value);
      if (record) { if (created) R.files[path].createdAt = created; save(record, path); }
      return result;
    };
  }
  const originalRemove = FM.prototype.remove;
  FM.prototype.remove = function (path) {
    path = normalize(path);
    const removed = Object.keys(R.files).filter(key => key === path || key.startsWith(path + '/')).map(scriptAt).filter(Boolean);
    const result = originalRemove.call(this, path);
    for (const record of new Map(removed.map(record => [record.id, record])).values()) removeRecord(record);
    return result;
  };
  for (const method of ['move', 'copy']) {
    const original = FM.prototype[method];
    FM.prototype[method] = function (source, destination) {
      source = normalize(source); destination = normalize(destination);
      if (source === destination) return original.call(this, source, destination);
      const record = scriptAt(source);
      if (record) {
        // A mirror may not yet exist on disk, or may hold an older editor save.
        // Materialize the authoritative source before the native copy/move.
        R.persist('file.op', { op: 'writeString', path: source, text: this.readString(source) });
      }
      const result = original.call(this, source, destination);
      if (!record) return result;
      const name = destinationName(destination);
      delete R.files[destination]._scriptId;
      if (name) {
        const next = { ...record, id: method === 'copy' ? self.UUID.string() : record.id, name };
        save(next, destination);
      } else if (method === 'move') removeRecord(record);
      return result;
    };
  }
})();
