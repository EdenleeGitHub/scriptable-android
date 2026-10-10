'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assets = path.resolve(__dirname, '../app/src/main/assets');
const core = fs.readFileSync(path.join(assets, 'runtime.js'), 'utf8');
const system = fs.readFileSync(path.join(assets, 'runtime-system.js'), 'utf8');

// Real Worker transport and final-drain behavior, with provider results mocked.
// Tests never access local contacts, calendars, photos or external composers.
async function run(code, handler = () => null, extra = {}, sync = () => null) {
  const messages = [], operations = []; let endResolve;
  const ending = new Promise(resolve => { endResolve = resolve; });
  const sandbox = { setTimeout, clearTimeout, TextEncoder, TextDecoder, Uint8Array, console,
    crypto: require('node:crypto').webcrypto,
    btoa: value => Buffer.from(value, 'binary').toString('base64'), atob: value => Buffer.from(value, 'base64').toString('binary'),
    XMLHttpRequest: class {
      open(method, url) { this.url = url; }
      send() { const url = new URL(this.url); try { this.responseText = JSON.stringify({ ok: true, result: sync(url.searchParams.get('action'), JSON.parse(url.searchParams.get('payload'))) }); this.status = 200; } catch (error) { this.status = 200; this.responseText = JSON.stringify({ ok: false, error: error.message }); } }
    },
    postMessage(message) {
      message = structuredClone(message); messages.push(message);
      if (message.type === 'host') {
        operations.push(message);
        Promise.resolve().then(() => handler(message)).then(result => sandbox.onmessage({ data: { type: 'hostResult', id: message.id, ok: true, result } }), error => sandbox.onmessage({ data: { type: 'hostResult', id: message.id, ok: false, error: error.message } }));
      }
      if (message.type === 'error' || message.type === 'done') endResolve(message);
    }
  };
  sandbox.self = sandbox; const context = vm.createContext(sandbox);
  sandbox.importScripts = (...names) => { if (names.includes('runtime-system.js')) vm.runInContext(system, context, { filename: 'runtime-system.js' }); };
  vm.runInContext(core, context);
  sandbox.onmessage({ data: { type: 'run', code, context: { script: { id: 'test', name: 'Test' }, device: { locale: 'en-US', brightness: .5 }, nativeSyncUrl: 'https://appassets.androidplatform.net/native-sync', ...extra } } });
  const timeout = setTimeout(() => endResolve({ type: 'error', message: 'Harness timed out' }), 3000);
  const end = await ending; clearTimeout(timeout); return { end, operations, messages };
}
const list = { identifier: 'reminders-default', title: 'Tasks', kind: 'reminders', color: '#00AAFF', allowsContentModifications: true };
const eventList = { identifier: '8', title: 'Work', kind: 'events', color: '#00AAFF', allowsContentModifications: true, availabilities: ['busy', 'free'] };
const photo = { base64: Buffer.from([0, 1, 2]).toString('base64'), mimeType: 'image/jpeg', width: 10, height: 20 };
const logs = result => result.messages.filter(message => message.type === 'log').map(message => message.values);

test('loading system APIs does not request personal data or permissions', async () => {
  const result = await run(`const e=new CalendarEvent(), c=new Contact(), r=new Reminder(); console.log(e.title,c.givenName,r.isOverdue);`);
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result), [['', '', false]]); assert.equal(result.operations.length, 0);
});
test('location accuracy and locale reach native; denied access is catchable; invalid coordinates stay local', async () => {
  const result = await run(`Location.setAccuracyToKilometer(); const p=await Location.current(); const a=await Location.reverseGeocode(p.latitude,p.longitude,'zh-CN'); console.log(p.horizontalAccuracy,a[0].country); try{await Location.reverseGeocode(100,0)}catch(e){console.log('invalid')} try{await Location.current()}catch(e){console.log(e.message)}`, message => {
    if (message.action === 'location.reverseGeocode') { assert.equal(message.payload.locale, 'zh-CN'); return [{ country: 'China' }]; }
    assert.equal(message.payload.accuracy, 1000);
    if (message.id === 1) return { latitude: 30, longitude: 120, horizontalAccuracy: 500 };
    throw new Error('Location permission denied');
  });
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result), [[500, 'China'], ['invalid'], ['Location permission denied']]); assert.equal(result.operations.length, 3);
});
test('event provider schema retains actual IDs, Date objects, recurrence, calendar colors and availability', async () => {
  const result = await run(`const c=await Calendar.defaultForEvents();const e=new CalendarEvent();e.calendar=c;e.title='Planning';e.startDate=new Date(1000);e.endDate=new Date(2000);e.addRecurrenceRule(RecurrenceRule.weeklyOccurrenceCount(2,5));await e.save();console.log(e.identifier,e.startDate instanceof Date,e.calendar.color.hex,e.calendar.supportsAvailability('free'));const items=await CalendarEvent.between(new Date(0),new Date(3000),[c]);console.log(items[0].endDate.getTime());`, message => {
    if (message.action === 'calendar.list') return [eventList];
    if (message.action === 'event.save') { assert.equal(message.payload.calendar.identifier, '8'); assert.equal(message.payload.calendar.color, '#00AAFF'); assert.deepEqual(message.payload.recurrenceRules, ['FREQ=WEEKLY;INTERVAL=2;COUNT=5']); return { ...message.payload, identifier: '99', calendar: eventList }; }
    assert.equal(message.action, 'event.list'); assert.deepEqual(message.payload.calendars, ['8']); return [{ identifier: '99', startDate: 1000, endDate: 2000, calendar: eventList }];
  });
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result), [['99', true, '00AAFF', true], [2000]]);
});
test('calendar picker preserves read-only properties and rejects saving without an event account', async () => {
  const readonly = { ...eventList, allowsContentModifications: false };
  const result = await run(`const values=await Calendar.presentPicker(true);console.log(values[0].allowsContentModifications,values[0].kind);try{await Calendar.defaultForEvents()}catch(e){console.log('no account')}`, message => {
    if (message.action === 'calendar.list') return message.payload.kind === 'events' ? [readonly] : [list];
    assert.equal(message.action, 'calendar.picker'); assert.equal(message.payload.values[0].allowsContentModifications, false); return [message.payload.values[0]];
  });
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result), [[false, 'events'], ['no account']]);
});
test('unawaited event and photo failures are surfaced by the core final drain', async () => {
  for (const code of [`const e=new CalendarEvent();e.calendar=await Calendar.defaultForEvents();e.save();`, `Photos.fromLibrary();`]) {
    const result = await run(code, message => { if (message.action === 'calendar.list') return [eventList]; throw new Error('Provider refused the action'); });
    assert.equal(result.end.type, 'error'); assert.match(result.end.message, /Provider refused/);
  }
});
test('reminder filters and dates use provider timestamps and local calendar IDs', async () => {
  const result = await run(`const c=await Calendar.defaultForReminders();const r=await Reminder.incompleteDueBetween(new Date(100),new Date(200),[c]);console.log(r[0].dueDate instanceof Date,r[0].dueDate.getTime(),r[0].isCompleted);`, message => {
    if (message.action === 'calendar.list') return [list];
    assert.deepEqual(message.payload, { calendars: ['reminders-default'], completion: false, scheduled: false, startDate: 100, endDate: 200, dateField: 'dueDate' });
    return [{ identifier: 'r1', dueDate: 150, isCompleted: false, calendar: list }];
  });
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result), [[true, 150, false]]);
});
test('reminder save cancels old alarms and schedules the current or next recurring instance', async () => {
  const now = Date.now() + 60000; let saves = 0;
  const result = await run(`const r=new Reminder();r.title='Drink water';r.calendar=await Calendar.defaultForReminders();r.dueDate=new Date(${now});r.addRecurrenceRule(RecurrenceRule.daily(1));await r.save();r.isCompleted=true;await r.save();console.log(r.identifier,r.isCompleted);`, message => {
    if (message.action === 'calendar.list') return [list];
    if (message.action === 'reminder.save') { const value = { ...message.payload, identifier: 'r1', creationDate: now - 1000, completionDate: message.payload.isCompleted ? now : null }; if (++saves === 2) value._nextReminder = { identifier: 'r2', title: 'Drink water', dueDate: now + 86400000, notes: '' }; return value; }
    return true;
  });
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result), [['r1', true]]);
  const scheduled = result.operations.filter(op => op.action === 'notification.schedule'); assert.equal(scheduled.length, 2); assert.equal(scheduled[0].payload.triggerDate, now); assert.equal(scheduled[1].payload.identifier, 'reminder:r2');
  assert.equal(result.operations.filter(op => op.action === 'notification.removePending').length, 2);
  assert.equal(result.operations.filter(op => op.action === 'notification.removeDelivered').length, 1);
});
test('deleting a reminder removes its durable item and all associated notifications', async () => {
  const result = await run(`const values=await Reminder.all();await values[0].remove();`, message => message.action === 'reminder.list' ? [{ identifier: 'one', calendar: list }] : true);
  assert.equal(result.end.type, 'done'); assert.deepEqual(result.operations.map(op => op.action), ['reminder.list', 'reminder.remove', 'notification.removePending', 'notification.removeDelivered']);
});
test('Contact changes are queued until one atomic transaction, then returned IDs become usable', async () => {
  let transactions = 0;
  const result = await run(`const c=new Contact();c.givenName='Ada';c.phoneNumbers=[{label:'Home',value:'123'}];c.birthday=new Date(0);Contact.add(c,'local');console.log(c.identifier);await Contact.persistChanges();console.log(c.identifier);Contact.delete(c);await Contact.persistChanges();`, message => {
    assert.equal(message.action, 'contacts.persist'); ++transactions;
    const change = message.payload.changes[0]; if (transactions === 1) { assert.equal(change.value.givenName, 'Ada'); assert.equal(change.value.birthday, 0); assert.equal(change.containerIdentifier, 'local'); assert.equal(change.object, undefined); return [{ identifier: 'contact:10' }]; }
    assert.equal(change.op, 'delete'); assert.equal(change.value.identifier, 'contact:10'); return [{ identifier: 'contact:10' }];
  });
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result), [[''], ['contact:10']]); assert.equal(transactions, 2);
});
test('failed contact transactions can be retried without silently dropping queued changes', async () => {
  let count = 0;
  const result = await run(`const c=new Contact();c.givenName='Test';Contact.add(c);try{await Contact.persistChanges()}catch(e){console.log(e.message)}await Contact.persistChanges();console.log(c.identifier);`, () => { if (++count === 1) throw new Error('Permission denied'); return [{ identifier: 'contact:11' }]; });
  assert.equal(result.end.type, 'done'); assert.equal(count, 2); assert.deepEqual(logs(result), [['Permission denied'], ['contact:11']]);
});
test('contacts and groups revive dates and commit membership alongside names', async () => {
  const result = await run(`const containers=await ContactsContainer.all();const c=(await Contact.all(containers))[0];console.log(c.birthday instanceof Date,c.dates[0].value instanceof Date);const g=new ContactsGroup();g.name='Friends';g.addMember(c);ContactsGroup.add(g,containers[0].identifier);await Contact.persistChanges();console.log(g.identifier);`, message => {
    if (message.action === 'contacts.containers') return [{ identifier: 'local', name: 'Device' }];
    if (message.action === 'contacts.list') { assert.deepEqual(message.payload.containers, ['local']); return [{ identifier: 'contact:4', birthday: 1000, dates: [{ value: 2000, label: 'Anniversary' }] }]; }
    assert.deepEqual(message.payload.changes[0].value.members, [{ op: 'add', identifier: 'contact:4' }]); return [{ identifier: '6' }];
  });
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result), [[true, true], ['6']]);
});
test('system document imports update the synchronous file snapshot before scripts read or export', async () => {
  const result = await run(`const path=await DocumentPicker.openFile();const f=FileManager.local();console.log(path,f.readString(path));const out=await DocumentPicker.export(path);console.log(out[0]);`, message => {
    if (message.action === 'documents.open') { assert.equal(message.payload.multiple, false); return { paths: ['/documents/import-test/hello.txt'], files: { '/documents/import-test': { type: 'directory' }, '/documents/import-test/hello.txt': { type: 'file', text: '你好' } } }; }
    assert.equal(message.action, 'documents.export'); assert.equal(Buffer.from(message.payload.base64, 'base64').toString('utf8'), '你好'); assert.equal(message.payload.name, 'hello.txt'); return ['content://provider/documents/output'];
  });
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result), [['/documents/import-test/hello.txt', '你好'], ['content://provider/documents/output']]);
});
test('photo methods return encoded Image objects and receive a real binary save payload', async () => {
  const result = await run(`const im=await Photos.fromLibrary();await Photos.save(im);const screenshots=await Photos.latestScreenshots(2);console.log(im instanceof Image,im.mimeType,im.data.getBytes(),screenshots.length);`, message => {
    if (message.action === 'photos.pick') return photo;
    if (message.action === 'photos.latest') { assert.deepEqual(message.payload, { count: 2, screenshots: true }); return [photo, photo]; }
    assert.equal(message.action, 'photos.save'); assert.equal(message.payload.base64, photo.base64); assert.equal(message.payload.mimeType, 'image/jpeg'); return true;
  });
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result), [[true, 'image/jpeg', [0, 1, 2], 2]]);
});
test('mail and SMS only invoke the system composer and retain recipient, HTML and attachment data', async () => {
  const result = await run(`const m=new Mail();m.toRecipients=['ada@example.com'];m.ccRecipients=['cc@example.com'];m.bccRecipients=['bcc@example.com'];m.subject='Hello';m.body='<b>你好</b>';m.isBodyHTML=true;m.addDataAttachment(Data.fromString('attachment'),'text/plain','a.txt');const reply=await m.send();console.log(reply.status,reply.sent);const sms=new Message();sms.recipients=['123'];sms.body='Test';await sms.send();`, message => {
    if (message.action === 'compose.mail') { assert.deepEqual(message.payload.to, ['ada@example.com']); assert.deepEqual(message.payload.bcc, ['bcc@example.com']); assert.equal(message.payload.isBodyHTML, true); assert.equal(message.payload.attachments[0].name, 'a.txt'); assert.equal(Buffer.from(message.payload.attachments[0].base64, 'base64').toString(), 'attachment'); }
    else { assert.equal(message.action, 'compose.message'); assert.deepEqual(message.payload.to, ['123']); }
    return { status: 'externalComposerOpened', sent: null };
  });
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result), [['externalComposerOpened', null]]);
});
test('date pickers revive dates, countdown returns seconds, cancelled dictation is catchable', async () => {
  const result = await run(`const p=new DatePicker();p.minuteInterval=15;p.minimumDate=new Date(0);const d=await p.pickDateAndTime();const seconds=await p.pickCountdownDuration();console.log(d instanceof Date,d.getTime(),seconds);try{await Dictation.start('en-US')}catch(e){console.log(e.message)}`, message => {
    if (message.action === 'dictation.start') { assert.equal(message.payload.locale, 'en-US'); throw new Error('User cancelled dictation'); }
    assert.equal(message.payload.minuteInterval, 15); return message.payload.mode === 'countdown' ? 3600 : 1700000000000;
  });
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result), [[true, 1700000000000, 3600], ['User cancelled dictation']]);
});
test('all recurrence factories build RFC5545 selectors with Sunday=1 and reject invalid ranges', async () => {
  const result = await run(`console.log(RecurrenceRule.complexWeeklyOccurrenceCount(2,[1,2,7],[-1],5).rule,RecurrenceRule.complexMonthly(1,[2],[-1],[-1]).rule,RecurrenceRule.complexYearlyEndDate(1,[],[2],[-1],[-1],[],new Date('2030-01-01T00:00:00Z')).rule);for(const fn of [()=>RecurrenceRule.daily(0),()=>RecurrenceRule.weeklyOccurrenceCount(1,0),()=>RecurrenceRule.complexMonthly(1,[8],[],[]),()=>RecurrenceRule.complexYearly(1,[],[0],[],[],[])])try{fn()}catch(e){console.log('invalid')}`);
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result)[0], ['FREQ=WEEKLY;INTERVAL=2;BYDAY=SU,MO,SA;BYSETPOS=-1;COUNT=5', 'FREQ=MONTHLY;INTERVAL=1;BYDAY=MO;BYMONTHDAY=-1;BYSETPOS=-1', 'FREQ=YEARLY;INTERVAL=1;BYMONTH=2;BYWEEKNO=-1;BYYEARDAY=-1;UNTIL=20300101T000000Z']); assert.equal(logs(result).length, 5); assert.equal(result.operations.length, 0);
});
test('device brightness mutation and getters use the synchronous native endpoint', async () => {
  let brightness = .5;
  const result = await run(`Device.setScreenBrightness(.8);console.log(Device.screenBrightness(),Device.volume(),Device.identifierForVendor());try{Device.setScreenBrightness(2)}catch(e){console.log('invalid')}`, () => { throw new Error('No async calls expected'); }, {}, (action, payload) => {
    if (action === 'device.setBrightness') { brightness = payload.brightness; return true; }
    if (action === 'device.brightness') return brightness;
    if (action === 'device.volume') return .25;
    if (action === 'device.identifier') return 'scoped-id'; throw new Error(action);
  });
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result), [[.8, .25, 'scoped-id'], ['invalid']]);
});
test('group membership alone persists and a new contact/group can share one atomic transaction', async () => {
  let transactions = 0;
  const result = await run(`const c=new Contact();c.givenName='First';const g=new ContactsGroup();g.name='Team';ContactsGroup.add(g);Contact.add(c);g.addMember(c);c.givenName='Final';await Contact.persistChanges();g.removeMember(c);await Contact.persistChanges();console.log(c.identifier,g.identifier);`, message => {
    assert.equal(message.action, 'contacts.persist'); const changes = message.payload.changes;
    if (++transactions === 1) { assert.equal(changes[0].type, 'group'); assert.deepEqual(changes[0].value.members, [{ op: 'add', reference: 1 }]); assert.equal(changes[1].value.givenName, 'Final'); return [{ identifier: '9' }, { identifier: 'contact:8' }]; }
    assert.equal(changes.length, 1); assert.equal(changes[0].type, 'group'); assert.equal(changes[0].op, 'update'); assert.deepEqual(changes[0].value.members, [{ op: 'remove', identifier: 'contact:8' }]); return [{ identifier: '9' }];
  });
  assert.equal(result.end.type, 'done'); assert.equal(transactions, 2); assert.deepEqual(logs(result), [['contact:8', '9']]);
});
test('device orientation, full language preferences and physical screen resolution preserve native facts', async () => {
  const result = await run(`console.log(Device.screenResolution().width,Device.screenResolution().height,Device.preferredLanguages(),Device.batteryLevel(),Device.isCharging(),Device.isDischarging(),Device.isFullyCharged());console.log(Device.isInPortrait(),Device.isInPortraitUpsideDown(),Device.isInLandscapeLeft(),Device.isInLandscapeRight(),Device.isFaceUp(),Device.isFaceDown());`, () => null, {}, action => {
    if (action === 'device.screen') return { widthPixels: 1080, heightPixels: 2400 };
    if (action === 'device.preferredLanguages') return ['zh-CN', 'en-US'];
    if (action === 'device.battery') return { level: 1, isCharging: false, isDischarging: false, isFullyCharged: true };
    if (action === 'device.orientation') return { isInPortrait: false, isInPortraitUpsideDown: false, isInLandscapeLeft: true, isInLandscapeRight: false, isFaceUp: false, isFaceDown: true };
    throw new Error(action);
  });
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result), [[1080, 2400, ['zh-CN', 'en-US'], 1, false, false, true], [false, false, true, false, false, true]]);
});
test('every official system API member in the fetched inventory is present on the correct object surface', async () => {
  const inventory = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../docs/api-inventory.json'), 'utf8'));
  const types = { calendar: 'Calendar', calendarevent: 'CalendarEvent', contact: 'Contact', contactscontainer: 'ContactsContainer', contactsgroup: 'ContactsGroup', reminder: 'Reminder', recurrencerule: 'RecurrenceRule', documentpicker: 'DocumentPicker', dictation: 'Dictation', datepicker: 'DatePicker', photos: 'Photos', mail: 'Mail', message: 'Message', location: 'Location', device: 'Device' };
  const entries = inventory.filter(entry => types[entry.type]);
  const result = await run(`const entries=${JSON.stringify(entries)},types=${JSON.stringify(types)};const absent=[];for(const entry of entries){const Type=self[types[entry.type]];let instance=null;if(['Calendar','CalendarEvent','Contact','ContactsGroup','Reminder','DatePicker','Mail','Message'].includes(types[entry.type]))instance=new Type();if(types[entry.type]==='ContactsContainer')instance=new Type({identifier:'test',name:'Test'});for(const member of entry.members){if(member.includes('new '))continue;const key=member.replace(/^[+-]/,'');const value=member[0]==='+'?Type:instance;if(member[0]==='+'||member[0]==='-'){if(typeof value?.[key]!=='function')absent.push(entry.type+'.'+member)}else if(!(key in value))absent.push(entry.type+'.'+member)}}console.log(absent);`);
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result), [[[]]]);
});
test('a rejected multi-document capacity transaction leaves the current file snapshot and next script usable', async () => {
  const originalFiles = { '/documents/important.txt': { type: 'file', text: 'existing data' } };
  const result = await run(`try{await DocumentPicker.open()}catch(e){console.log(e.message)}const f=FileManager.local();console.log(f.readString('/documents/important.txt'),f.listContents('/documents'));`, message => {
    assert.equal(message.action, 'documents.open');
    // A native prospective-capacity rejection returns no imported paths/snapshot.
    throw new Error('File snapshot exceeds the 4 MB limit; import was rolled back');
  }, { files: originalFiles });
  assert.equal(result.end.type, 'done'); assert.deepEqual(logs(result), [['File snapshot exceeds the 4 MB limit; import was rolled back'], ['existing data', ['important.txt']]]);
  const next = await run(`console.log(FileManager.local().readString('/documents/important.txt'));`, () => null, { files: originalFiles });
  assert.equal(next.end.type, 'done'); assert.deepEqual(logs(next), [['existing data']]);
});
