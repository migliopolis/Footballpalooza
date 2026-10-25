#!/usr/bin/env python3
"""Turn data/bylaws-2027.md into data/bylaws.json for the hub's By-Laws tab.

Headings become the collapsible levels: # article, ## section, ### and #### sub-parts.
Change tags written as [[CHANGED]], [[NEW]] or [[REMOVED]] become badges.
Run after editing the markdown (needs `pip install markdown`; the weekly Action doesn't run this).
"""
import json, os, re, markdown

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'bylaws-2027.md')
OUT = os.path.join(ROOT, 'data', 'bylaws.json')
TAG = re.compile(r'\[\[(CHANGED|NEW|REMOVED)\]\]')


def badge(html):
    return TAG.sub(lambda m: f'<span class="bl-tag bl-{m.group(1).lower()}">{m.group(1).title()}</span>', html)


def build():
    text = open(SRC, encoding='utf-8').read()
    root = {'children': [], 'level': 0}
    stack, buf = [root], []

    def flush():
        node = stack[-1]
        body = '\n'.join(buf).strip()
        if body:
            node['html'] = node.get('html', '') + badge(markdown.markdown(body, extensions=['tables', 'sane_lists']))
        buf.clear()

    for line in text.split('\n'):
        m = re.match(r'^(#{1,4}) (.*)$', line)
        if m:
            flush()
            level, title = len(m.group(1)), m.group(2).strip()
            tags = [t.lower() for t in TAG.findall(title)]
            title = TAG.sub('', title).strip()
            while stack[-1]['level'] >= level:
                stack.pop()
            node = {'level': level, 'title': title, 'tags': tags, 'children': []}
            stack[-1]['children'].append(node)
            stack.append(node)
        else:
            buf.append(line)
    flush()

    def count(n):
        own = len(re.findall(r'class="bl-tag', n.get('html', ''))) + len(n.get('tags', []))
        n['changes'] = own + sum(count(c) for c in n['children'])
        return n['changes']
    for a in root['children']:
        count(a)
        m = re.match(r'Article ([IVXLC]+) – (.*)', a['title'])
        if m:
            a['num'], a['name'] = m.group(1), m.group(2)
        else:  # the 2027 summary: its tags only explain the badges
            a['changes'] = 0
    json.dump({'title': 'FBP League By-Laws', 'edition': '2027 draft', 'articles': root['children']},
              open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(f'Wrote {OUT}: {len(root["children"])} top-level items')


if __name__ == '__main__':
    build()
