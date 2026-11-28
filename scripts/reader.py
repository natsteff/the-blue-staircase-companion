"""Render the published EPUB's reading order for the web reader."""
from collections import Counter
from hashlib import sha256
from html import escape
import posixpath
import re
from urllib.parse import unquote, urlsplit
from xml.etree import ElementTree as ET
from zipfile import ZipFile

TAGS = set('section nav div h1 h2 h3 p em strong ul ol li hr br table thead tbody tr th td a img'.split())
PASSAGES = {'h1', 'h2', 'h3', 'p', 'li', 'tr'}
EPUB_TYPE = '{http://www.idpf.org/2007/ops}type'
XLINK_HREF = '{http://www.w3.org/1999/xlink}href'
IMAGE_EXTENSIONS = {'image/png': '.png', 'image/jpeg': '.jpg'}


def resolve(source, href):
    return posixpath.normpath(posixpath.join(posixpath.dirname(source), unquote(href))) if href else source


def render_section(content, audio, section_id, link, image, title_recording=None):
    choices = '|'.join(re.escape(phrase) for phrase in sorted(audio, key=len, reverse=True))
    pattern = re.compile(rf'(?<!\w)(?:{choices})(?!\w)', re.IGNORECASE) if choices else None
    occurrences = Counter()

    def render_text(value):
        if not value:
            return ''
        if pattern is None:
            return escape(value)
        parts = []
        start = 0
        for match in pattern.finditer(value):
            phrase = match.group()
            file, meaning = audio[phrase.casefold()]
            parts.append(escape(value[start:match.start()]))
            definition = escape(meaning or 'Not yet translated in this chapter.')
            parts.append(f'<button class="spoken" type="button" lang="es-MX" '
                         f'data-audio="{escape(file)}" data-meaning="{definition}" '
                         f'aria-pressed="false">{escape(phrase)}</button>')
            start = match.end()
        parts.append(escape(value[start:]))
        return ''.join(parts)

    def render(element):
        tag = element.tag.rsplit('}', 1)[-1]
        if tag not in TAGS:
            raise ValueError(f'Unsupported reader element in {section_id}: {tag}')
        if tag in {'hr', 'br'}:
            return f'<{tag}>'
        if tag == 'img':
            return image(element.attrib['src'], element.get('alt', ''))
        attributes = ''
        if tag in PASSAGES:
            passage = ''.join(element.itertext()).strip()
            fingerprint = sha256(passage.encode()).hexdigest()[:16]
            occurrences[fingerprint] += 1
            attributes = f' id="p-{fingerprint}-{occurrences[fingerprint]}" data-passage'
        if tag == 'div' and 'chapter-title-es' in element.get('class', '').split():
            title = ''.join(element.itertext()).strip()
            subtitle = escape(title)
            listen = ''
            if title_recording:
                expected_title, recording = title_recording
                if title != expected_title:
                    raise ValueError(f'Chapter subtitle mismatch in {section_id}')
                listen = (f' <button class="spoken title-audio" type="button" lang="en" '
                          f'data-audio="{escape(recording)}" aria-pressed="false" '
                          f'aria-label="Listen to the Spanish chapter title">▶ Listen</button>')
            return f'<div class="chapter-title-es" lang="es-MX"><p><em>{subtitle}</em>{listen}</p></div>'
        if tag == 'a':
            return f'<a{link(element.attrib["href"])}>{escape("".join(element.itertext()))}</a>'
        text = render_text(element.text)
        text += ''.join(render(child) + render_text(child.tail) for child in element)
        if tag == 'table':
            return f'<div class="reader-table"><table>{text}</table></div>'
        return f'<{tag}{attributes}>{text}</{tag}>'

    return ''.join(render(element) for element in content)


def reader_book(path, chapters, travelers, recordings):
    """Read EPUB spine entries, navigation, and book images from the approved file."""
    with ZipFile(path) as epub:
        container = ET.fromstring(epub.read('META-INF/container.xml'))
        package_path = container.find('.//{*}rootfile').attrib['full-path']
        package = ET.fromstring(epub.read(package_path))
        items = {item.attrib['id']: item for item in package.findall('./{*}manifest/{*}item')}
        types = {resolve(package_path, item.attrib['href']): item.attrib['media-type'] for item in items.values()}
        nav_item = next(item for item in items.values() if 'nav' in item.get('properties', '').split())
        nav_source = resolve(package_path, nav_item.attrib['href'])
        toc = next(node for node in ET.fromstring(epub.read(nav_source)).findall('.//{*}nav')
                   if node.get(EPUB_TYPE) == 'toc')
        toc_entries = {}
        for anchor in toc.findall('.//{*}a'):
            href = urlsplit(anchor.attrib['href'])
            target = resolve(nav_source, href.path)
            toc_entries.setdefault(target, (unquote(href.fragment), ''.join(anchor.itertext())))

        spine = []
        chapter_index = 0
        for ref in package.findall('./{*}spine/{*}itemref'):
            item = items[ref.attrib['idref']]
            if item.attrib['media-type'] != 'application/xhtml+xml':
                raise ValueError(f'Unexpected reader spine format: {item.attrib["id"]}')
            source = resolve(package_path, item.attrib['href'])
            body = ET.fromstring(epub.read(source)).find('{*}body')
            if source == nav_source:
                entry = dict(id='contents', title='Table of Contents', kind='contents')
            elif (cover := body.find('.//{http://www.w3.org/2000/svg}image')) is not None:
                entry = dict(id='cover', title='Front Cover', kind='cover')
            else:
                heading = body.find('.//{*}h1')
                title = ''.join(heading.itertext())
                section_id, label = toc_entries.get(source, (body[0].get('id'), title))
                if not section_id:
                    raise ValueError(f'Missing reader section ID: {source}')
                if title.startswith('Chapter '):
                    if chapter_index == len(chapters):
                        raise ValueError(f'Unexpected EPUB chapter: {title}')
                    chapter = chapters[chapter_index]
                    chapter_index += 1
                    if title.partition(': ')[2] != chapter['title']:
                        raise ValueError(f'The EPUB and companion chapter titles or order differ: {title}')
                    entry = dict(id=chapter['number'], title=title, kind='chapter')
                else:
                    entry = dict(id=section_id, title=label, kind='reference')
            spine.append((source, body, entry))

        if [entry['id'] for _, _, entry in spine if entry['kind'] == 'chapter'] != [c['number'] for c in chapters]:
            raise ValueError('The EPUB and companion chapter counts differ.')
        targets = {source: entry['id'] for source, _, entry in spine}
        if len({entry['id'] for _, _, entry in spine}) != len(spine) or toc_entries.keys() - targets.keys():
            raise ValueError('The EPUB has duplicate reader IDs or a contents entry outside its spine.')

        assets = {}
        sections = []
        for source, body, entry in spine:
            def image(href, alt):
                resource = resolve(source, href)
                extension = IMAGE_EXTENSIONS.get(types.get(resource))
                if not extension:
                    raise ValueError(f'Unsupported EPUB image: {href}')
                payload = epub.read(resource)
                file = f'assets/reader/{sha256(payload).hexdigest()[:16]}{extension}'
                assets[file] = payload
                return f'<img class="reader-image" src="{file}" alt="{escape(alt)}" data-passage>'

            def link(href):
                parsed = urlsplit(href)
                if parsed.scheme == 'https' and parsed.netloc:
                    return f' href="{escape(href)}"'
                if not (parsed.scheme or parsed.netloc or parsed.query):
                    target = targets.get(resolve(source, parsed.path))
                    if target is not None:
                        return f' href="#{escape(str(target))}" data-section="{escape(str(target))}"'
                raise ValueError(f'Unsupported EPUB link: {href}')

            audio = {}
            title_recording = None
            if entry['kind'] == 'chapter':
                chapter = chapters[entry['id'] - 1]
                if spanish_title := chapter.get('spanishTitle'):
                    title_recording = (spanish_title, recordings[spanish_title.casefold()])
                rows = chapter['vocabulary'] + chapter.get('evidence', [])
            elif entry['id'] == 'spanish-phrases-for-travelers':
                rows = travelers
            else:
                rows = []
            for row in rows:
                for phrase in row[0].split(' / '):
                    normalized = re.sub(r'(?<!\.)\.$', '', phrase.casefold())
                    if normalized in recordings:
                        audio[normalized] = recordings[normalized], row[1]

            if entry['kind'] == 'cover':
                cover = body.find('.//{http://www.w3.org/2000/svg}image')
                html = image(cover.attrib[XLINK_HREF], 'The Blue Staircase front cover')
            else:
                html = render_section([toc] if entry['kind'] == 'contents' else body,
                                      audio, entry['id'], link, image, title_recording)
            if entry['kind'] == 'chapter' and 'data-audio=' not in html:
                raise ValueError(f"No tappable passages in chapter {entry['id']}")
            sections.append({**entry, 'html': html})

    return sections, assets
