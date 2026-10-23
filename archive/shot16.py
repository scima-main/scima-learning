import sys, time, http.server, functools, threading, os
from playwright.sync_api import sync_playwright
Handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=os.path.abspath('site/home'))
httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 8099), Handler)
threading.Thread(target=httpd.serve_forever, daemon=True).start()
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width':1280,'height':900})
    pg.goto('http://127.0.0.1:8099/index.html'); pg.wait_for_timeout(700)
    pg.evaluate("() => loadDemoContent()"); pg.wait_for_timeout(800)
    pg.goto('http://127.0.0.1:8099/index.html#/decks/Languages'); pg.wait_for_timeout(900)
    bar = pg.locator('.container-actions').first
    print('SUBJECT:', [t.strip() for t in bar.locator('button').all_inner_texts()])
    pg.screenshot(path='"$ARENA_WORKSPACE"/shots/order-subject.png', clip={'x':80,'y':70,'width':1120,'height':260})
    pg.locator('.folder-item', has_text='Ancient').click(); pg.wait_for_timeout(600)
    bar = pg.locator('.container-actions').first
    print('FOLDER :', [t.strip() for t in bar.locator('button').all_inner_texts()])
    pg.screenshot(path='"$ARENA_WORKSPACE"/shots/order-folder.png', clip={'x':80,'y':70,'width':1120,'height':260})
    pg.goto('http://127.0.0.1:8099/index.html#/decks'); pg.wait_for_timeout(800)
    print('ROOT   :', [t.strip() for t in pg.locator('.container-actions button').all_inner_texts()])
    pg.screenshot(path='"$ARENA_WORKSPACE"/shots/order-root.png', clip={'x':80,'y':70,'width':1120,'height':260})
    b.close()
httpd.shutdown()
