import os
import time
import urllib.request
import xml.etree.ElementTree as ET
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

FEED_URL = "https://docs.cloud.google.com/feeds/bigquery-release-notes.xml"
CACHE_FILE = "feed_cache.xml"
CACHE_DURATION = 3600  # Cache for 1 hour

def fetch_feed(force_refresh=False):
    """Fetches the XML feed, either from the local cache or the live URL."""
    now = time.time()
    
    # Check if cache exists and is valid
    if not force_refresh and os.path.exists(CACHE_FILE):
        file_age = now - os.path.getmtime(CACHE_FILE)
        if file_age < CACHE_DURATION:
            try:
                with open(CACHE_FILE, "r", encoding="utf-8") as f:
                    return f.read(), "cache"
            except Exception as e:
                # If cache read fails, fallback to fetching
                app.logger.warning(f"Failed to read cache file: {e}")
                
    # Fetch from live feed
    try:
        req = urllib.request.Request(
            FEED_URL, 
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
        )
        with urllib.request.urlopen(req) as response:
            xml_data = response.read().decode("utf-8")
            
        # Save to cache
        try:
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                f.write(xml_data)
        except Exception as e:
            app.logger.error(f"Failed to write cache file: {e}")
            
        return xml_data, "live"
    except Exception as e:
        # Fallback to expired cache if live fetch fails
        if os.path.exists(CACHE_FILE):
            try:
                with open(CACHE_FILE, "r", encoding="utf-8") as f:
                    return f.read(), "expired_cache_fallback"
            except Exception:
                pass
        raise e

def parse_feed(xml_data):
    """Parses the Atom feed XML and returns a structured list of entries."""
    root = ET.fromstring(xml_data)
    ns = {'atom': 'http://www.w3.org/2005/Atom'}
    
    entries = []
    for entry_node in root.findall('atom:entry', ns):
        # Extract fields
        id_val = entry_node.findtext('atom:id', default='', namespaces=ns)
        title_val = entry_node.findtext('atom:title', default='', namespaces=ns)
        updated_val = entry_node.findtext('atom:updated', default='', namespaces=ns)
        
        # Link extraction
        link_node = entry_node.find('atom:link[@rel="alternate"]', ns)
        if link_node is None:
            link_node = entry_node.find('atom:link', ns)
        
        link_val = link_node.attrib.get('href', '') if link_node is not None else ''
        
        # Content extraction
        content_node = entry_node.find('atom:content', ns)
        content_val = content_node.text if content_node is not None else ''
        
        entries.append({
            'id': id_val,
            'title': title_val,
            'updated': updated_val,
            'link': link_val,
            'content': content_val
        })
        
    return entries

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/release-notes')
def get_release_notes():
    force_refresh = request.args.get('refresh', 'false').lower() == 'true'
    try:
        xml_data, source = fetch_feed(force_refresh=force_refresh)
        entries = parse_feed(xml_data)
        return jsonify({
            'success': True,
            'source': source,
            'count': len(entries),
            'entries': entries
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
