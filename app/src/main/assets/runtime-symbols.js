/* SF identifier compatibility using independent Apache-licensed Android glyphs. */
(() => {
  'use strict';
  const R = self.__runtime, Original = self.SFSymbol, originalNamed = Original.named.bind(Original);
  let catalog = null; const cache = new Map(); let warned = false;
  function data() { if (!catalog) { const reply = R.syncHost('symbols.catalog', {}); catalog = { ...reply, sfSet: new Set(reply.sf), mdi: reply.mdi }; } return catalog; }
  const aliases = {
    person: 'account', 'person.2': 'account-multiple', 'person.3': 'account-group', figure: 'human', 'figure.walk': 'walk', 'figure.run': 'run', 'figure.wave': 'human-greeting', 'figure.dance': 'human-female-dance', 'figure.hiking': 'hiking', 'figure.yoga': 'yoga', 'figure.pool.swim': 'swim',
    'sun.max': 'weather-sunny', 'sun.min': 'weather-sunny', 'sun.horizon': 'weather-sunset', sunrise: 'weather-sunset-up', sunset: 'weather-sunset-down', 'moon.stars': 'weather-night', moon: 'weather-night',
    'cloud.sun': 'weather-partly-cloudy', 'cloud.moon': 'weather-night-partly-cloudy', 'cloud.rain': 'weather-rainy', 'cloud.heavyrain': 'weather-pouring', 'cloud.drizzle': 'weather-partly-rainy', 'cloud.snow': 'weather-snowy', 'cloud.sleet': 'weather-snowy-rainy', 'cloud.hail': 'weather-hail', 'cloud.fog': 'weather-fog', 'cloud.bolt.rain': 'weather-lightning-rainy', 'cloud.bolt': 'weather-lightning', cloud: 'weather-cloudy', tornado: 'weather-tornado', hurricane: 'weather-hurricane', wind: 'weather-windy', snowflake: 'snowflake',
    'battery.100': 'battery', 'battery.75': 'battery-70', 'battery.50': 'battery-50', 'battery.25': 'battery-20', 'battery.0': 'battery-outline', battery: 'battery', bolt: 'lightning-bolt', humidity: 'water-percent', drop: 'water', thermometer: 'thermometer',
    magnifyingglass: 'magnify', 'arrow.clockwise': 'reload', 'arrow.counterclockwise': 'undo', 'arrow.triangle.2.circlepath': 'sync', 'arrow.triangle.branch': 'source-branch', arrow: 'arrow-right', chevron: 'chevron-right',
    house: 'home', building: 'office-building', 'building.2': 'office-building', 'building.columns': 'bank', doc: 'file-document', 'doc.text': 'file-document', 'doc.richtext': 'file-document-edit', 'doc.zipper': 'zip-box', document: 'file-document', folder: 'folder', book: 'book-open', books: 'bookshelf', bookmark: 'bookmark', note: 'note-text', newspaper: 'newspaper', clipboard: 'clipboard', list: 'format-list-bulleted', checklist: 'clipboard-check',
    'square.and.arrow.up': 'export-variant', 'square.and.arrow.down': 'download', 'square.and.pencil': 'square-edit-outline', square: 'square', rectangle: 'rectangle', triangle: 'triangle', circle: 'circle', seal: 'seal',
    iphone: 'cellphone', ipad: 'tablet', ipod: 'ipod', macbook: 'laptop', laptopcomputer: 'laptop', desktopcomputer: 'desktop-classic', display: 'monitor', appletv: 'television-box', tv: 'television', applewatch: 'watch', airpods: 'earbuds', airpodspro: 'earbuds', headphones: 'headphones', homepod: 'speaker', gamecontroller: 'gamepad-variant', keyboard: 'keyboard', computermouse: 'mouse', memorychip: 'memory', cpu: 'cpu-64-bit', opticaldisc: 'disc', disk: 'harddisk',
    'externaldrive': 'harddisk', 'network': 'lan', 'antenna.radiowaves.left.and.right': 'radio-tower', 'waveform': 'waveform', 'wifi': 'wifi', 'dot.radiowaves.left.and.right': 'access-point',
    'bubble.left': 'message', 'bubble.right': 'message-reply', 'bubble.left.and.bubble.right': 'forum', ellipsis: 'dots-horizontal', envelope: 'email', phone: 'phone', mic: 'microphone', megaphone: 'bullhorn', speaker: 'volume-high', 'music.note': 'music-note', 'music.mic': 'microphone',
    camera: 'camera', photo: 'image', 'photo.on.rectangle': 'image-multiple', 'person.crop.circle': 'account-circle', 'person.crop.square': 'account-box', video: 'video', film: 'filmstrip', 'play.rectangle': 'play-box', 'play.tv': 'television-play', play: 'play', pause: 'pause', stop: 'stop', forward: 'fast-forward', backward: 'rewind', repeat: 'repeat', shuffle: 'shuffle',
    calendar: 'calendar', clock: 'clock-outline', timer: 'timer-outline', stopwatch: 'timer-outline', alarm: 'alarm', hourglass: 'timer-sand', bell: 'bell', gear: 'cog', gearshape: 'cog', wrench: 'wrench', hammer: 'hammer', screwdriver: 'screwdriver', paintbrush: 'brush', paintpalette: 'palette', pencil: 'pencil', eraser: 'eraser', scissors: 'content-cut', trash: 'trash-can',
    heart: 'heart', star: 'star', sparkles: 'creation', lightbulb: 'lightbulb', 'flame': 'fire', leaf: 'leaf', tree: 'tree', flower: 'flower', pawprint: 'paw', dog: 'dog', cat: 'cat', bird: 'bird', fish: 'fish', rabbit: 'rabbit', ant: 'ant', ladybug: 'ladybug', turtle: 'turtle',
    lock: 'lock', key: 'key', shield: 'shield', eye: 'eye', hand: 'hand-back-right', 'hand.thumbsup': 'thumb-up', 'hand.thumbsdown': 'thumb-down', 'hand.raised': 'hand-back-right', 'hand.point.up': 'gesture-tap', face: 'emoticon-outline', 'face.smiling': 'emoticon-happy-outline', mouth: 'emoticon-tongue-outline', brain: 'brain', lungs: 'lungs', ear: 'ear-hearing', tooth: 'tooth', cross: 'medical-bag', pills: 'pill', bandage: 'bandage', syringe: 'needle', stethoscope: 'stethoscope',
    location: 'navigation', mappin: 'map-marker', map: 'map', globe: 'earth', compass: 'compass-outline', car: 'car', bus: 'bus', tram: 'tram', train: 'train', bicycle: 'bicycle', scooter: 'scooter', airplane: 'airplane', sailboat: 'sail-boat', ferry: 'ferry', truck: 'truck', fuelpump: 'gas-station', road: 'road', steeringwheel: 'steering', parkingsign: 'parking',
    cart: 'cart', basket: 'basket', bag: 'shopping', creditcard: 'credit-card', banknote: 'cash', wallet: 'wallet', gift: 'gift', shippingbox: 'package-variant', tag: 'tag', ticket: 'ticket', 'dollarsign': 'currency-usd', 'eurosign': 'currency-eur', 'sterlingsign': 'currency-gbp', 'yensign': 'currency-jpy', 'bitcoinsign': 'currency-btc',
    cup: 'cup', wineglass: 'glass-wine', fork: 'silverware-fork', 'fork.knife': 'silverware-fork-knife', spoon: 'silverware-spoon', birthday: 'cake', birthdaycake: 'cake', carrot: 'carrot', apple: 'food-apple', pizza: 'pizza', soccerball: 'soccer', basketball: 'basketball', baseball: 'baseball', tennisball: 'tennis-ball', football: 'football', hockey: 'hockey-sticks', trophy: 'trophy', medal: 'medal', rosette: 'seal',
    chart: 'chart-bar', 'chart.xyaxis.line': 'chart-line', 'chart.pie': 'chart-pie', 'chart.bar': 'chart-bar', 'chart.line': 'chart-line', function: 'function', sum: 'sigma', percent: 'percent', number: 'pound', at: 'at', link: 'link', paperclip: 'paperclip', pin: 'pin', flag: 'flag', checkmark: 'check', xmark: 'close', plus: 'plus', minus: 'minus', multiply: 'multiplication', divide: 'division', equal: 'equal', info: 'information-outline', questionmark: 'help', exclamationmark: 'exclamation',
    'exclamationmark.triangle': 'alert', 'questionmark.diamond': 'help-rhombus', 'checkmark.shield': 'shield-check', 'xmark.shield': 'shield-remove', 'lock.shield': 'shield-lock', 'checkmark.seal': 'check-decagram', 'checkmark.circle': 'check-circle', 'info.circle': 'information', 'questionmark.circle': 'help-circle',
    'a.circle': 'alpha-a-circle', 'a.square': 'alpha-a-box', 'text': 'format-text', 'character': 'alphabetical', 'rectangle.and.text.magnifyingglass': 'text-box-search', 'qrcode': 'qrcode', 'barcode': 'barcode', 'captions.bubble': 'closed-caption', accessibility: 'human',
    textformat: 'format-text', richtext: 'text-box', inset: 'dock-window', arrowshape: 'arrow-right-bold', arrowtriangle: 'triangle', poweroutlet: 'power-socket', powerplug: 'power-plug', beats: 'headphones', carseat: 'car-seat', suv: 'car-estate', convertible: 'car-convertible', hifispeaker: 'speaker', gauge: 'gauge', point: 'vector-point', ev: 'ev-station', gobackward: 'rewind', goforward: 'fast-forward', wave: 'waves', line: 'minus', button: 'gesture-tap-button', light: 'lightbulb', sun: 'weather-sunny', moonphase: 'moon-first-quarter', numbers: 'numeric', pointer: 'cursor-default', cursorarrow: 'cursor-default', dot: 'circle-small', capsule: 'pill', door: 'door', slider: 'tune', suitcase: 'bag-suitcase', vision: 'virtual-reality', visionpro: 'virtual-reality', windshield: 'car-windshield', app: 'application', apps: 'apps', signpost: 'sign-direction', fan: 'fan', oval: 'ellipse', squareshape: 'square',
    australiandollarsign: 'currency-usd', bahtsign: 'currency-thb', brazilianrealsign: 'currency-brl', chineseyuanrenminbisign: 'currency-cny', dongsign: 'currency-vnd', eurozonesign: 'currency-eur', francsign: 'currency-chf', hryvniasign: 'currency-uah', indianrupeesign: 'currency-inr', lirasign: 'currency-try', nairasign: 'currency-ngn', pesosign: 'currency-php', polishzlotysign: 'currency-pln', rublesign: 'currency-rub', rupeesign: 'currency-inr', shekelsign: 'currency-ils', sterlingsign: 'currency-gbp', tengesign: 'currency-kzt', tugriksign: 'currency-mnt', turkishlirasign: 'currency-try', wonsign: 'currency-krw',
  };
  function lookup(name) {
    if (cache.has(name)) return cache.get(name); const { mdi } = data(), filled = name.includes('.fill');
    const wrapper = /(?:^|\.)(circle|square|rectangle)(?:\.|$)/.exec(name), badge = /\.badge\.(plus|minus|checkmark|xmark|exclamationmark|questionmark)/.exec(name)?.[1] || (name.includes('.badge') ? 'dot' : null);
    const literal = /^([0-9]{1,2}|[a-z])\.(circle|square|rectangle)(?:\.|$)/.exec(name);
    if (literal) { const result = { mdiName: /^\d/.test(literal[1]) ? 'numeric' : 'alphabetical', textValue: literal[1], confidence: 'literal-text', isFallback: false, circle: literal[2] === 'circle', square: literal[2] !== 'circle', shapeFilled: filled, badge }; cache.set(name, result); return result; }
    const base = name.replace(/\.fill/g, '').replace(/\.badge(?:\.[a-z0-9]+)?/g, '').replace(/\.(?:circle|square|rectangle)(?:\.fill)?$/g, '');
    let mdiName = null, confidence = null;
    const candidates = [name.replace(/\.fill/g, '').replace(/\./g, '-'), base.replace(/\./g, '-')];
    for (const candidate of candidates) if (mdi[candidate]) { mdiName = candidate; confidence = 'exact-name'; break; }
    if (!mdiName) {
      for (const candidate of [name.replace(/\.fill/g, ''), base]) if (aliases[candidate] && mdi[aliases[candidate]]) { mdiName = aliases[candidate]; confidence = 'semantic-alias'; break; }
    }
    if (!mdiName) {
      const parts = base.split('.');
      for (let end = parts.length; end > 0; end--) { const prefix = parts.slice(0, end).join('.'), candidate = aliases[prefix]; if (candidate && mdi[candidate]) { mdiName = candidate; confidence = 'category'; break; } }
    }
    const numeric = /^([0-9]{1,2}|[a-z])\.(circle|square)(?:\.fill)?$/.exec(name);
    if (numeric) { const candidate = (/^\d/.test(numeric[1]) ? 'numeric-' : 'alpha-') + numeric[1] + '-' + (numeric[2] === 'square' ? 'box' : 'circle') + (filled ? '' : '-outline'); if (mdi[candidate]) { mdiName = candidate; confidence = 'semantic-alias'; } }
    if (!mdiName) { mdiName = 'help-circle-outline'; confidence = 'generic-fallback'; }
    if (!filled && mdi[mdiName + '-outline']) mdiName += '-outline';
    if (name.includes('.slash') || name.includes('.off')) { const off = mdiName.replace(/-outline$/, '') + '-off'; if (mdi[off]) mdiName = off; }
    const result = { mdiName, confidence, isFallback: confidence === 'generic-fallback', circle: wrapper?.[1] === 'circle' && !/(?:-circle|-circle-outline)$/.test(mdiName), square: wrapper && wrapper[1] !== 'circle' && !/(?:-box|-box-outline)$/.test(mdiName), badge };
    cache.set(name, result); return result;
  }
  class AndroidSymbol extends Original {
    constructor(name, mapping) { super(name); this.platformIcon = mapping.textValue ? 'text:' + mapping.textValue : mapping.mdiName; this.isFallback = mapping.isFallback; this.mappingConfidence = mapping.confidence; this._mapping = mapping; }
    get image() {
      const reply = R.syncHost('symbols.render', { mdiName: this._mapping.mdiName, textValue: this._mapping.textValue, shapeFilled: !!this._mapping.shapeFilled, size: this._fontSize, weight: this._weight, circle: !!this._mapping.circle, square: !!this._mapping.square, badge: this._mapping.badge });
      const image = new self.Image(self.Data.fromBase64String(reply.base64), reply.mimeType || 'image/png'); image._imageSize = new self.Size(reply.width, reply.height); return image;
    }
  }
  Original.named = function (name) {
    if (typeof name !== 'string') throw new TypeError('Symbol name must be a string.');
    const original = originalNamed(name); if (original) { original.platformIcon = 'original:' + name; original.isFallback = false; original.mappingConfidence = 'original'; return original; }
    if (!data().sfSet.has(name)) return null; const mapping = lookup(name);
    if (mapping.isFallback && !warned) { warned = true; self.console.warn(`SFSymbol: no close Android equivalent for "${name}"; using the labelled ${mapping.mdiName} fallback. Check symbol.isFallback / symbol.platformIcon.`); }
    return new AndroidSymbol(name, mapping);
  };
  Original.android = function (mdiName) { if (typeof mdiName !== 'string') throw new TypeError('Android icon name must be a string.'); return Object.hasOwn(data().mdi, mdiName) ? new AndroidSymbol(mdiName, { mdiName, isFallback: false, confidence: 'android', circle: false, square: false, badge: null }) : null; };
  Original.coverage = function () { const { sf, mdi } = data(), counts = { original: 0, 'literal-text': 0, 'exact-name': 0, 'semantic-alias': 0, category: 0, 'generic-fallback': 0 }; for (const name of sf) if (originalNamed(name)) counts.original++; else counts[lookup(name).confidence]++; return { sfVersion: '7.0', names: sf.length, androidIcons: Object.keys(mdi).length, ...counts }; };
})();
