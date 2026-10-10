/* Android equivalents for Scriptable's personal-data and system APIs. */
(() => {
  'use strict';
  const R = self.__runtime;
  if (!R) throw new Error('The core runtime must be loaded before runtime-system.js.');
  const host = (action, payload) => R.host(action, payload || {});
  const observed = fn => function (...args) { return R.observe(Promise.resolve().then(() => fn.apply(this, args))); };
  const methods = (object, names) => names.forEach(name => { object[name] = observed(object[name]); });
  const date = (value, name) => {
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError(`${name || 'Date'} must be a valid Date.`);
    return value.getTime();
  };
  const ids = (values, type) => values == null ? null : values.map(value => {
    if (!(value instanceof type) || !value.identifier) throw new TypeError(`Expected saved ${type.name} objects.`);
    return String(value.identifier);
  });
  const imageReply = value => {
    const image = new self.Image(self.Data.fromBase64String(value.base64), value.mimeType || 'image/png');
    if (value.width && value.height) image._imageSize = new self.Size(value.width, value.height);
    return image;
  };
  const imagePayload = image => {
    if (!(image instanceof self.Image)) throw new TypeError('Expected an Image.');
    const data = image.data || image._data;
    if (data instanceof self.Data) return { base64: data.toBase64String(), mimeType: image.mimeType || 'image/png' };
    const uri = image.toJSON();
    if (typeof uri !== 'string' || !uri.startsWith('data:')) throw new Error('The image cannot be encoded.');
    return { base64: uri.substring(uri.indexOf(',') + 1), mimeType: uri.slice(5, uri.indexOf(';')) };
  };
  const Location = {
    _accuracy: 0,
    current() { return host('location.current', { accuracy: this._accuracy }); },
    reverseGeocode(latitude, longitude, locale) {
      if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180) throw new RangeError('Invalid geographic coordinates.');
      return host('location.reverseGeocode', { latitude, longitude, locale: locale || self.Device.locale() });
    },
    setAccuracyToBest() { this._accuracy = 0; }, setAccuracyToTenMeters() { this._accuracy = 10; },
    setAccuracyToHundredMeters() { this._accuracy = 100; }, setAccuracyToKilometer() { this._accuracy = 1000; },
    setAccuracyToThreeKilometers() { this._accuracy = 3000; }
  };
  Location.requestBackgroundAccess = () => host('location.backgroundAccess');
  Location.setGeocodingProvider = endpoint => {
    if (endpoint != null && typeof endpoint !== 'string') throw new TypeError('Geocoding endpoint must be an HTTPS string, or null to disable.');
    return host('location.configureGeocoding', { endpoint: endpoint || '' });
  };
  methods(Location, ['current', 'reverseGeocode', 'requestBackgroundAccess', 'setGeocodingProvider']);

  class RecurrenceRule {
    constructor(frequency, interval, selectors = {}, ending = {}) {
      if (!Number.isInteger(interval) || interval < 1) throw new RangeError('Recurrence interval must be a positive integer.');
      this.frequency = frequency; this.interval = interval;
      this.selectors = selectors; this.endDate = ending.endDate || null; this.occurrenceCount = ending.occurrenceCount || null;
      const values = [`FREQ=${frequency}`, `INTERVAL=${interval}`];
      for (const [key, array] of Object.entries(selectors)) if (array.length) values.push(`${key}=${array.join(',')}`);
      if (ending.endDate) values.push(`UNTIL=${new Date(date(ending.endDate)).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`);
      if (ending.occurrenceCount != null) {
        if (!Number.isInteger(ending.occurrenceCount) || ending.occurrenceCount < 1) throw new RangeError('Occurrence count must be a positive integer.');
        values.push(`COUNT=${ending.occurrenceCount}`);
      }
      this.rule = values.join(';');
    }
    toJSON() { return this.rule; }
  }
  const weekdays = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  function selector(values, key, min, max, excludeZero = false) {
    if (values == null) return [];
    if (!Array.isArray(values)) throw new TypeError(`${key} must be an array.`);
    return values.map(value => {
      if (!Number.isInteger(value) || value < min || value > max || (excludeZero && value === 0)) throw new RangeError(`${key} contains an invalid value.`);
      return key === 'BYDAY' ? weekdays[value - 1] : value;
    });
  }
  for (const [name, frequency] of Object.entries({ daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY', yearly: 'YEARLY' })) {
    RecurrenceRule[name] = interval => new RecurrenceRule(frequency, interval);
    RecurrenceRule[name + 'EndDate'] = (interval, endDate) => new RecurrenceRule(frequency, interval, {}, { endDate });
    RecurrenceRule[name + 'OccurrenceCount'] = (interval, occurrenceCount) => new RecurrenceRule(frequency, interval, {}, { occurrenceCount });
  }
  for (const [name, frequency, fields] of [
    ['complexWeekly', 'WEEKLY', [['BYDAY', 1, 7], ['BYSETPOS', -366, 366, true]]],
    ['complexMonthly', 'MONTHLY', [['BYDAY', 1, 7], ['BYMONTHDAY', -31, 31, true], ['BYSETPOS', -366, 366, true]]],
    ['complexYearly', 'YEARLY', [['BYDAY', 1, 7], ['BYMONTH', 1, 12], ['BYWEEKNO', -53, 53, true], ['BYYEARDAY', -366, 366, true], ['BYSETPOS', -366, 366, true]]]
  ]) {
    const build = (interval, args, ending = {}) => new RecurrenceRule(frequency, interval,
      Object.fromEntries(fields.map(([key, min, max, zero], index) => [key, selector(args[index], key, min, max, zero)])), ending);
    RecurrenceRule[name] = (interval, ...args) => build(interval, args);
    RecurrenceRule[name + 'EndDate'] = (interval, ...args) => build(interval, args, { endDate: args[fields.length] });
    RecurrenceRule[name + 'OccurrenceCount'] = (interval, ...args) => build(interval, args, { occurrenceCount: args[fields.length] });
  }
  class Calendar {
    constructor(value = {}) {
      Object.assign(this, { identifier: '', title: '', allowsContentModifications: true, isSubscribed: false, kind: 'reminders' }, value);
      if (!(this.color instanceof self.Color)) this.color = new self.Color(value.color || '#477EF7');
    }
    supportsAvailability(value) { return this.kind === 'events' && (this.availabilities || ['busy', 'free', 'tentative']).includes(value); }
    _payload() { return { identifier: this.identifier, title: String(this.title), kind: this.kind, color: '#' + this.color.hex, allowsContentModifications: this.allowsContentModifications, isSubscribed: this.isSubscribed, availabilities: this.availabilities }; }
    async save() { const value = await host('calendar.save', this._payload()); Object.assign(this, new Calendar(value)); }
    async remove() {
      const reminders = this.kind === 'reminders' ? await Reminder.all([this]) : [];
      const value = await host('calendar.remove', this._payload());
      if (reminders.length) { const identifiers = reminders.map(item => 'reminder:' + item.identifier); await host('notification.removePending', { identifiers }); await host('notification.removeDelivered', { identifiers }); }
      return value;
    }
    static async forEvents() { return (await host('calendar.list', { kind: 'events' })).map(value => new Calendar(value)); }
    static async forReminders() { return (await host('calendar.list', { kind: 'reminders' })).map(value => new Calendar(value)); }
    static async forEventsByTitle(title) { return Calendar._byTitle(await this.forEvents(), title); }
    static async forRemindersByTitle(title) { return Calendar._byTitle(await this.forReminders(), title); }
    static _byTitle(values, title) { const value = values.find(item => item.title === title); if (!value) throw new Error(`Calendar was not found: ${title}`); return value; }
    static async createForReminders(title) { return new Calendar(await host('calendar.save', { title: String(title), kind: 'reminders', color: '#477EF7' })); }
    static async findOrCreateForReminders(title) { const values = await this.forReminders(); return values.find(item => item.title === title) || await this.createForReminders(title); }
    static async defaultForReminders() { return (await this.forReminders())[0]; }
    static async defaultForEvents() { const values = await this.forEvents(); const result = values.find(value => value.allowsContentModifications); if (!result) throw new Error('No writable Android calendar is configured. Add an account in the system Calendar app.'); return result; }
    static async presentPicker(allowMultiple = false) {
      const values = [...await this.forEvents(), ...await this.forReminders()];
      return (await host('calendar.picker', { values: values.map(value => value._payload()), allowMultiple: !!allowMultiple })).map(value => new Calendar(value));
    }
  }
  methods(Calendar.prototype, ['save', 'remove']);
  methods(Calendar, ['forEvents', 'forReminders', 'forEventsByTitle', 'forRemindersByTitle', 'createForReminders', 'findOrCreateForReminders', 'defaultForReminders', 'defaultForEvents', 'presentPicker']);
  function reviveItem(value, Type) {
    const item = new Type(); Object.assign(item, value);
    for (const field of ['startDate', 'endDate', 'dueDate', 'completionDate', 'creationDate']) if (value[field] != null) item[field] = new Date(value[field]);
    if (value.calendar) item.calendar = new Calendar(value.calendar);
    item._rules = (value.recurrenceRules || []).slice(); return item;
  }
  function intervalRange(period, shift) {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    if (period === 'week') { const first = new Intl.Locale(self.Device.locale()).weekInfo?.firstDay || 1; start.setDate(start.getDate() - (start.getDay() - first + 7) % 7 + shift * 7); }
    else start.setDate(start.getDate() + shift);
    const end = new Date(start); end.setDate(end.getDate() + (period === 'week' ? 7 : 1));
    return [start, end];
  }
  class CalendarEvent {
    constructor() {
      this.identifier = ''; this.title = ''; this.location = ''; this.notes = ''; this.startDate = new Date();
      this.endDate = new Date(Date.now() + 3600000); this.isAllDay = false; this.attendees = []; this.availability = 'busy';
      this.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; this.calendar = null; this._rules = [];
    }
    addRecurrenceRule(rule) { if (!(rule instanceof RecurrenceRule)) throw new TypeError('Expected RecurrenceRule.'); this._rules.push(rule.rule); }
    removeAllRecurrenceRules() { this._rules = []; }
    _payload() {
      const startDate = date(this.startDate, 'Start date'), endDate = date(this.endDate, 'End date');
      if (endDate < startDate) throw new RangeError('End date must not precede start date.');
      return { identifier: this.identifier, title: String(this.title), location: String(this.location || ''), notes: String(this.notes || ''), startDate, endDate, isAllDay: !!this.isAllDay, availability: this.availability, timeZone: this.timeZone, calendar: this.calendar?._payload(), recurrenceRules: this._rules };
    }
    async save() {
      if (!this.calendar) this.calendar = await Calendar.defaultForEvents();
      if (this.calendar.kind !== 'events') throw new Error('An event requires an event calendar.');
      const value = await host('event.save', this._payload()); Object.assign(this, reviveItem(value, CalendarEvent));
    }
    remove() { if (!this.identifier) throw new Error('The event has not been saved.'); return host('event.remove', { identifier: this.identifier }); }
    async presentEdit() {
      const value = await host('event.edit', this._payload()); Object.assign(this, reviveItem(value, CalendarEvent)); return this;
    }
    static async presentCreate() { return reviveItem(await host('event.edit', new CalendarEvent()._payload()), CalendarEvent); }
    static async between(startDate, endDate, calendars) {
      const start = date(startDate), end = date(endDate); if (end < start) throw new RangeError('End date must not precede start date.');
      return (await host('event.list', { startDate: start, endDate: end, calendars: ids(calendars, Calendar) })).map(value => reviveItem(value, CalendarEvent));
    }
  }
  for (const [name, period, shift] of [['today', 'day', 0], ['tomorrow', 'day', 1], ['yesterday', 'day', -1], ['thisWeek', 'week', 0], ['nextWeek', 'week', 1], ['lastWeek', 'week', -1]]) {
    CalendarEvent[name] = calendars => CalendarEvent.between(...intervalRange(period, shift), calendars);
  }
  methods(CalendarEvent.prototype, ['save', 'remove', 'presentEdit']);
  methods(CalendarEvent, ['presentCreate', 'between', 'today', 'tomorrow', 'yesterday', 'thisWeek', 'nextWeek', 'lastWeek']);
  class Reminder {
    constructor() { this.identifier = ''; this.title = ''; this.notes = ''; this.isCompleted = false; this.priority = 0; this.dueDate = null; this.dueDateIncludesTime = true; this.completionDate = null; this.creationDate = null; this.calendar = null; this._rules = []; }
    get isOverdue() { return !this.isCompleted && this.dueDate != null && this.dueDate.getTime() < Date.now(); }
    addRecurrenceRule(rule) { CalendarEvent.prototype.addRecurrenceRule.call(this, rule); }
    removeAllRecurrenceRules() { this._rules = []; }
    async save() {
      if (!this.calendar) this.calendar = await Calendar.defaultForReminders();
      if (this.calendar.kind !== 'reminders') throw new Error('A reminder requires a reminder list.');
      if (!Number.isInteger(this.priority) || this.priority < 0 || this.priority > 9) throw new RangeError('Reminder priority must be from 0 to 9.');
      const value = await host('reminder.save', { identifier: this.identifier, title: String(this.title), notes: String(this.notes || ''), priority: this.priority, isCompleted: !!this.isCompleted, dueDate: this.dueDate == null ? null : date(this.dueDate), dueDateIncludesTime: !!this.dueDateIncludesTime, calendar: this.calendar._payload(), recurrenceRules: this._rules });
      Object.assign(this, reviveItem(value, Reminder));
      const identifiers = ['reminder:' + this.identifier];
      await host('notification.removePending', { identifiers });
      if (!this.isCompleted && this.dueDate) await host('notification.schedule', { identifier: identifiers[0], title: this.title || '提醒事项', body: this.notes, sound: 'default', triggerDate: Math.max(Date.now() + 1000, this.dueDate.getTime()) });
      if (this.isCompleted) await host('notification.removeDelivered', { identifiers });
      if (value._nextReminder?.dueDate) await host('notification.schedule', { identifier: 'reminder:' + value._nextReminder.identifier, title: value._nextReminder.title || '提醒事项', body: value._nextReminder.notes, sound: 'default', triggerDate: Math.max(Date.now() + 1000, value._nextReminder.dueDate) });
      delete this._nextReminder;
    }
    async remove() {
      if (!this.identifier) throw new Error('The reminder has not been saved.');
      const value = await host('reminder.remove', { identifier: this.identifier });
      const identifiers = ['reminder:' + this.identifier]; await host('notification.removePending', { identifiers }); await host('notification.removeDelivered', { identifiers }); return value;
    }
    static async _fetch(calendars, completion, due, completed, scheduled) {
      const payload = { calendars: ids(calendars, Calendar), completion, scheduled: !!scheduled };
      if (due) Object.assign(payload, { startDate: date(due[0]), endDate: date(due[1]), dateField: 'dueDate' });
      if (completed) Object.assign(payload, { startDate: date(completed[0]), endDate: date(completed[1]), dateField: 'completionDate' });
      return (await host('reminder.list', payload)).map(value => reviveItem(value, Reminder));
    }
    static all(calendars) { return this._fetch(calendars, null); }
    static scheduled(calendars) { return this._fetch(calendars, false, null, null, true); }
    static allCompleted(calendars) { return this._fetch(calendars, true); }
    static allIncomplete(calendars) { return this._fetch(calendars, false); }
    static allDueBetween(start, end, calendars) { return this._fetch(calendars, null, [start, end]); }
    static completedDueBetween(start, end, calendars) { return this._fetch(calendars, true, [start, end]); }
    static incompleteDueBetween(start, end, calendars) { return this._fetch(calendars, false, [start, end]); }
    static completedBetween(start, end, calendars) { return this._fetch(calendars, true, null, [start, end]); }
  }
  for (const [suffix, period, shift] of [['Today', 'day', 0], ['Tomorrow', 'day', 1], ['Yesterday', 'day', -1], ['ThisWeek', 'week', 0], ['NextWeek', 'week', 1], ['LastWeek', 'week', -1]]) {
    for (const [prefix, completion] of [['all', null], ['completed', true], ['incomplete', false]]) Reminder[prefix + 'Due' + suffix] = calendars => Reminder._fetch(calendars, completion, intervalRange(period, shift));
    Reminder['completed' + suffix] = calendars => Reminder._fetch(calendars, true, null, intervalRange(period, shift));
  }
  methods(Reminder.prototype, ['save', 'remove']);
  methods(Reminder, Object.getOwnPropertyNames(Reminder).filter(name => !['length', 'name', 'prototype', '_fetch'].includes(name)));

  const contactChanges = [];
  let contactCommit = Promise.resolve();
  class ContactsContainer {
    constructor(value) { Object.assign(this, value); }
    static async all() { return (await host('contacts.containers')).map(value => new ContactsContainer(value)); }
    static async default() { return (await this.all())[0]; }
    static async withIdentifier(identifier) { const value = (await this.all()).find(value => value.identifier === identifier); if (!value) throw new Error('Contacts container was not found.'); return value; }
  }
  methods(ContactsContainer, ['all', 'default', 'withIdentifier']);
  const contactFields = ['namePrefix', 'givenName', 'middleName', 'familyName', 'nickname', 'note', 'organizationName', 'departmentName', 'jobTitle'];
  const contactArrays = ['emailAddresses', 'phoneNumbers', 'postalAddresses', 'socialProfiles', 'urlAddresses', 'dates'];
  class Contact {
    constructor() {
      this.identifier = ''; this.birthday = null; this.image = null;
      contactFields.forEach(field => { this[field] = ''; }); contactArrays.forEach(field => { this[field] = []; });
      for (const field of [...contactFields, ...contactArrays, 'birthday', 'image']) this['is' + field[0].toUpperCase() + field.slice(1) + 'Available'] = true;
      this.isGiveNameAvailable = true; this.isURLAddressesAvailable = true;
    }
    _payload() {
      const value = { identifier: this.identifier, birthday: this.birthday ? date(this.birthday) : null, image: this.image ? imagePayload(this.image) : null };
      for (const field of [...contactFields, ...contactArrays]) value[field] = this[field];
      return value;
    }
    static _revive(value) { const result = Object.assign(new Contact(), value); if (value.birthday != null) result.birthday = new Date(value.birthday); if (value.image?.base64) result.image = imageReply(value.image); for (const entry of result.dates) if (entry.value != null) entry.value = new Date(entry.value); return result; }
    static async all(containers) { return (await host('contacts.list', { containers: ids(containers, ContactsContainer) })).map(this._revive); }
    static async inGroups(groups) { return (await host('contacts.list', { groups: ids(groups, ContactsGroup) })).map(this._revive); }
    static add(contact, containerIdentifier) { if (!(contact instanceof Contact)) throw new TypeError('Expected Contact.'); if (contact.identifier || contact._queued) throw new Error('This contact already exists or is queued; use Contact.update after it has been saved.'); contact._queued = true; contactChanges.push({ op: 'add', type: 'contact', value: contact._payload(), containerIdentifier, object: contact }); }
    static update(contact) { if (!(contact instanceof Contact) || !contact.identifier) throw new TypeError('Expected a saved Contact.'); contactChanges.push({ op: 'update', type: 'contact', value: contact._payload(), object: contact }); }
    static delete(contact) { if (!(contact instanceof Contact) || !contact.identifier) throw new TypeError('Expected a saved Contact.'); contactChanges.push({ op: 'delete', type: 'contact', value: { identifier: contact.identifier } }); }
    static persistChanges() {
      const commit = async () => {
        if (!contactChanges.length) return;
        const changes = contactChanges.splice(0), members = new Map();
        try {
          const payload = changes.map(({ object, ...change }, index) => {
            if (change.type === 'contact' && object && change.op !== 'delete') change.value = object._payload();
            if (change.type === 'group' && object && change.op !== 'delete') {
              const pending = object._members.slice(); members.set(object, pending.length);
              change.value = { identifier: object.identifier, name: String(object.name), members: pending.map(member => {
                if (member.contact.identifier) return { op: member.op, identifier: member.contact.identifier };
                const reference = changes.findIndex(entry => entry.type === 'contact' && entry.op === 'add' && entry.object === member.contact);
                if (reference < 0) throw new Error('Queue Contact.add before persisting a new group member.');
                return { op: member.op, reference };
              }) };
            }
            return change;
          });
          const results = await host('contacts.persist', { changes: payload });
          results.forEach((value, index) => {
            const object = changes[index]?.object;
            if (object && value?.identifier) { object.identifier = value.identifier; delete object._queued; }
          });
          for (const [object, count] of members) object._members.splice(0, count);
        } catch (error) { contactChanges.unshift(...changes); throw error; }
      };
      const result = contactCommit.catch(() => {}).then(commit); contactCommit = result; return result;
    }
  }
  methods(Contact, ['all', 'inGroups', 'persistChanges']);
  class ContactsGroup {
    constructor() { this.identifier = ''; this.name = ''; this._members = []; }
    static async all(containers) { return (await host('contacts.groups', { containers: ids(containers, ContactsContainer) })).map(value => Object.assign(new ContactsGroup(), value)); }
    addMember(contact) { this._member('add', contact); }
    removeMember(contact) { this._member('remove', contact); }
    _member(op, contact) {
      if (!(contact instanceof Contact) || (!contact.identifier && !contact._queued)) throw new TypeError('Expected a saved Contact or one queued with Contact.add.');
      this._members.push({ op, contact });
      if (this.identifier && !contactChanges.some(change => change.object === this && change.type === 'group')) ContactsGroup._queue('update', this);
    }
    static _queue(op, group, containerIdentifier) {
      if (!(group instanceof ContactsGroup)) throw new TypeError('Expected ContactsGroup.');
      if (op !== 'add' && !group.identifier) throw new Error('The group has not been saved.');
      if (op === 'add' && (group.identifier || group._queued)) throw new Error('This group is already saved or queued.');
      const existing = contactChanges.find(change => change.object === group && change.type === 'group');
      if (existing && op === 'update') return;
      if (op === 'add') group._queued = true;
      contactChanges.push({ op, type: 'group', value: { identifier: group.identifier, name: String(group.name) }, containerIdentifier, object: group });
    }
    static add(group, containerIdentifier) { this._queue('add', group, containerIdentifier); }
    static update(group) { this._queue('update', group); }
    static delete(group) { this._queue('delete', group); }
  }
  methods(ContactsGroup, ['all']);

  const Photos = {
    async fromLibrary() { return imageReply(await host('photos.pick')); }, async fromCamera() { return imageReply(await host('photos.camera')); },
    async latestPhotos(count) { if (!Number.isInteger(count) || count < 1 || count > 100) throw new RangeError('Photo count must be from 1 to 100.'); return (await host('photos.latest', { count })).map(imageReply); },
    async latestPhoto() { const values = await this.latestPhotos(1); if (!values.length) throw new Error('No photos are available.'); return values[0]; },
    async latestScreenshots(count) { if (!Number.isInteger(count) || count < 1 || count > 100) throw new RangeError('Screenshot count must be from 1 to 100.'); return (await host('photos.latest', { count, screenshots: true })).map(imageReply); },
    async latestScreenshot() { const values = await this.latestScreenshots(1); if (!values.length) throw new Error('No screenshots are available.'); return values[0]; },
    removeLatestPhotos(count) { if (!Number.isInteger(count) || count < 1 || count > 100) throw new RangeError('Photo count must be from 1 to 100.'); return host('photos.remove', { count }); },
    removeLatestPhoto() { return this.removeLatestPhotos(1); },
    removeLatestScreenshots(count) { if (!Number.isInteger(count) || count < 1 || count > 100) throw new RangeError('Screenshot count must be from 1 to 100.'); return host('photos.remove', { count, screenshots: true }); },
    removeLatestScreenshot() { return this.removeLatestScreenshots(1); },
    save(image) { return host('photos.save', imagePayload(image)); }
  };
  methods(Photos, Object.keys(Photos));
  async function importDocuments(payload) {
    const value = await host('documents.open', payload);
    if (value.files) R.updateFiles(value.files);
    return value.paths;
  }
  function fileExport(path) {
    const entry = R.files[path];
    if (!entry || entry.type !== 'file') throw new Error('File does not exist or is a directory.');
    return { base64: entry.base64 || self.Data.fromString(entry.text || '').toBase64String(), name: path.slice(path.lastIndexOf('/') + 1), mimeType: 'application/octet-stream' };
  }
  const DocumentPicker = {
    open(types) { return importDocuments({ types: types || [], multiple: true }); },
    async openFile() { return (await importDocuments({ multiple: false }))[0]; },
    async openFolder() { return (await importDocuments({ folder: true }))[0]; },
    export(path) { return host('documents.export', fileExport(path)); },
    exportString(content, name = 'Document.txt') { if (typeof content !== 'string') throw new TypeError('Content must be a string.'); return host('documents.export', { base64: self.Data.fromString(content).toBase64String(), name, mimeType: 'text/plain' }); },
    exportImage(image, name = 'Image.png') { return host('documents.export', { ...imagePayload(image), name }); },
    exportData(data, name = 'Data.bin') { if (!(data instanceof self.Data)) throw new TypeError('Expected Data.'); return host('documents.export', { base64: data.toBase64String(), name, mimeType: 'application/octet-stream' }); },
    async importString() { return self.FileManager.local().readString(await this.openFile()); },
    async importImage() { const path = (await this.open(['public.image']))[0]; return self.FileManager.local().readImage(path); }
  };
  methods(DocumentPicker, Object.keys(DocumentPicker));
  const Dictation = { start(locale = self.Device.locale()) { return host('dictation.start', { locale }); } };
  methods(Dictation, ['start']);
  class DatePicker {
    constructor() { this.minimumDate = null; this.maximumDate = null; this.countdownDuration = 0; this.minuteInterval = 1; this.initialDate = new Date(); }
    async _pick(mode) {
      if (!Number.isInteger(this.minuteInterval) || ![1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30].includes(this.minuteInterval)) throw new RangeError('Minute interval must divide 60.');
      const value = await host('date.pick', { mode, initialDate: date(this.initialDate), minimumDate: this.minimumDate ? date(this.minimumDate) : null, maximumDate: this.maximumDate ? date(this.maximumDate) : null, countdownDuration: this.countdownDuration, minuteInterval: this.minuteInterval });
      return mode === 'countdown' ? value : new Date(value);
    }
    pickTime() { return this._pick('time'); } pickDate() { return this._pick('date'); }
    pickDateAndTime() { return this._pick('datetime'); } pickCountdownDuration() { return this._pick('countdown'); }
  }
  methods(DatePicker.prototype, ['pickTime', 'pickDate', 'pickDateAndTime', 'pickCountdownDuration']);
  class Composer {
    constructor() { this._attachments = []; this.body = ''; }
    addImageAttachment(image) { this._attachments.push({ ...imagePayload(image), name: `Image.${image.mimeType === 'image/jpeg' ? 'jpg' : 'png'}` }); }
    addFileAttachment(path) { this._attachments.push(fileExport(path)); }
    addDataAttachment(data, mimeType, filename) { if (!(data instanceof self.Data)) throw new TypeError('Expected Data.'); this._attachments.push({ base64: data.toBase64String(), mimeType: mimeType || 'application/octet-stream', name: filename || 'Attachment.bin' }); }
    send() {
      const isMail = this instanceof Mail;
      return host(isMail ? 'compose.mail' : 'compose.message', { attachments: this._attachments, body: String(this.body || ''), subject: this.subject || '', to: isMail ? this.toRecipients : this.recipients, cc: this.ccRecipients || [], bcc: this.bccRecipients || [], isBodyHTML: !!this.isBodyHTML, preferredSendingEmailAddress: this.preferredSendingEmailAddress || '' });
    }
  }
  class Mail extends Composer { constructor() { super(); this.toRecipients = []; this.ccRecipients = []; this.bccRecipients = []; this.subject = ''; this.isBodyHTML = false; this.preferredSendingEmailAddress = ''; } }
  class Message extends Composer { constructor() { super(); this.recipients = []; } }
  methods(Composer.prototype, ['send']);
  self.Device.screenBrightness = () => R.syncHost ? R.syncHost('device.brightness') : R.context.device.brightness ?? 0.5;
  self.Device.setScreenBrightness = brightness => {
    if (!Number.isFinite(brightness) || brightness < 0 || brightness > 1) throw new RangeError('Brightness must be between 0 and 1.');
    if (R.syncHost) R.syncHost('device.setBrightness', { brightness });
    else R.persist('device.setBrightness', { brightness });
    R.context.device.brightness = brightness;
  };
  self.Device.volume = () => R.syncHost ? R.syncHost('device.volume') : R.context.device.volume ?? 0;
  self.Device.identifierForVendor = () => R.syncHost ? R.syncHost('device.identifier') : R.context.device.identifier || '';
  const deviceValue = (action, fallback) => R.syncHost ? R.syncHost(action) : fallback;
  self.Device.preferredLanguages = () => deviceValue('device.preferredLanguages', R.context.device.preferredLanguages || [self.Device.locale()]);
  self.Device.screenResolution = () => {
    const size = R.context.device.screenResolution || { widthPixels: (R.context.device.screenSize?.width || 0) * (R.context.device.screenScale || 1), heightPixels: (R.context.device.screenSize?.height || 0) * (R.context.device.screenScale || 1) };
    const value = deviceValue('device.screen', size); return new self.Size(value.widthPixels, value.heightPixels);
  };
  const battery = () => deviceValue('device.battery', { level: R.context.device.batteryLevel, isCharging: R.context.device.isCharging, isDischarging: R.context.device.isDischarging ?? !R.context.device.isCharging, isFullyCharged: R.context.device.batteryLevel === 1 });
  self.Device.batteryLevel = () => battery().level;
  for (const name of ['isCharging', 'isDischarging', 'isFullyCharged']) self.Device[name] = () => !!battery()[name];
  for (const name of ['isInPortrait', 'isInPortraitUpsideDown', 'isInLandscapeLeft', 'isInLandscapeRight', 'isFaceUp', 'isFaceDown']) self.Device[name] = () => !!deviceValue('device.orientation', R.context.device.orientation || { isInPortrait: self.Device.screenSize().height >= self.Device.screenSize().width })[name];
  R.register({ Location, RecurrenceRule, Calendar, CalendarEvent, Reminder, Contact, ContactsContainer, ContactsGroup, Photos, DocumentPicker, Dictation, DatePicker, Mail, Message });
})();
