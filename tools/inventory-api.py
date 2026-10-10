"""Build a local method/property index from the public Scriptable documentation."""
import concurrent.futures
from html.parser import HTMLParser
import json
from pathlib import Path
import urllib.request

base = 'https://docs.scriptable.app/'
class IndexParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.links = set()
    def handle_starttag(self,tag,attrs):
        if tag != 'a': return
        href = dict(attrs).get('href','')
        if href.endswith('/') and href.count('/') == 1 and not href.startswith(('#','http','/')):
            self.links.add(href)
class PageParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.capture = None; self.text = []; self.members = []
    def handle_starttag(self,tag,attrs):
        if tag == 'h2': self.capture = tag; self.text = []
    def handle_data(self,data):
        if self.capture: self.text.append(data)
    def handle_endtag(self,tag):
        if tag == self.capture:
            title = ''.join(self.text).replace('¶','').strip()
            if title and title not in ('Parameters','Return value'): self.members.append(title)
            self.capture = None
def fetch(url):
    request = urllib.request.Request(url,headers={'User-Agent':'ScriptableAndroid compatibility inventory'})
    return urllib.request.urlopen(request,timeout=40).read().decode('utf-8')
index = IndexParser(); index.feed(fetch(base))
def entry(slug):
    parser = PageParser(); parser.feed(fetch(base+slug))
    return {'type':slug.rstrip('/'),'source':base+slug,'members':parser.members}
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
    entries = list(executor.map(entry,sorted(index.links)))
dest = Path(__file__).resolve().parent.parent/'docs/api-inventory.json'
dest.parent.mkdir(parents=True,exist_ok=True)
dest.write_text(json.dumps(entries,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'{len(entries)} API pages / {sum(len(entry["members"]) for entry in entries)} documented members: {dest}')
