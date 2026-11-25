"""Render the published EPUB's numbered chapters for the web reader."""
from collections import Counter
from hashlib import sha256
from html import escape
import posixpath
import re
from urllib.parse import unquote
from xml.etree import ElementTree as ET
from zipfile import ZipFile

TAGS = set('section h1 h2 h3 p em strong ul ol li hr br table thead tbody tr th td'.split())
PASSAGES = {'h1', 'h2', 'h3', 'p', 'li', 'tr'}


def render_chapter(body, chapter, recordings):
    rows = chapter['vocabulary'] + chapter.get('evidence', [])
    phrases = [phrase for row in rows for phrase in row[0].split(' / ')]
    audio = {phrase.casefold(): recordings[phrase.casefold()]
             for phrase in (re.sub(r'(?<!\.)\.$', '', phrase) for phrase in phrases)
             if phrase.casefold() in recordings}
    if not audio:
        raise ValueError(f"No reader recordings for chapter {chapter['number']}")
    choices = '|'.join(re.escape(phrase) for phrase in sorted(audio, key=len, reverse=True))
    pattern = re.compile(rf'(?<!\w)(?:{choices})(?!\w)', re.IGNORECASE)
    occurrences = Counter()
    match_count = 0

    def render_text(value):
        nonlocal match_count
        if not value:
            return ''
        parts = []
        start = 0
        for match in pattern.finditer(value):
            phrase = match.group()
            file = audio[phrase.casefold()]
            parts.append(escape(value[start:match.start()]))
            parts.append(f'<button class="spoken" type="button" lang="es-MX" '
                         f'data-audio="{escape(file)}" aria-pressed="false">{escape(phrase)}</button>')
            start = match.end()
            match_count += 1
        parts.append(escape(value[start:]))
        return ''.join(parts)

    def render(element):
        tag = element.tag.rsplit('}', 1)[-1]
        if tag not in TAGS:
            raise ValueError(f'Unsupported chapter element: {tag}')
        if tag in {'hr', 'br'}:
            return f'<{tag}>'
        attributes = ''
        if tag in PASSAGES:
            passage = ''.join(element.itertext()).strip()
            fingerprint = sha256(passage.encode()).hexdigest()[:16]
            occurrences[fingerprint] += 1
            attributes = f' id="p-{fingerprint}-{occurrences[fingerprint]}" data-passage'
        text = render_text(element.text)
        text += ''.join(render(child) + render_text(child.tail) for child in element)
        if tag == 'table':
            return f'<div class="reader-table"><table>{text}</table></div>'
        return f'<{tag}{attributes}>{text}</{tag}>'

    html = ''.join(render(section) for section in body)
    if not match_count:
        raise ValueError(f"No tappable passages in chapter {chapter['number']}")
    return html


def reader_chapters(path, chapters, recordings):
    """Follow the EPUB spine and identify the story chapters by their titles."""
    with ZipFile(path) as epub:
        container = ET.fromstring(epub.read('META-INF/container.xml'))
        package_path = container.find('.//{*}rootfile').attrib['full-path']
        package = ET.fromstring(epub.read(package_path))
        items = {item.get('id'): item for item in package.findall('./{*}manifest/{*}item')}
        bodies = {}
        for ref in package.findall('./{*}spine/{*}itemref'):
            item = items[ref.get('idref')]
            if item.get('media-type') != 'application/xhtml+xml':
                continue
            source = posixpath.join(posixpath.dirname(package_path), unquote(item.get('href')))
            body = ET.fromstring(epub.read(source)).find('{*}body')
            heading = body.find('.//{*}h1')
            if heading is not None and (title := ''.join(heading.itertext())).startswith('Chapter '):
                bodies[title.partition(': ')[2]] = body
        if list(bodies) != [chapter['title'] for chapter in chapters]:
            raise ValueError('The EPUB and companion chapter titles or order differ.')
        return [dict(number=chapter['number'], title=chapter['title'],
                     html=render_chapter(bodies[chapter['title']], chapter, recordings))
                for chapter in chapters]
