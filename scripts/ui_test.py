"""Browser test of the editor against the TEST-ONLY stub builds (Clerk stand-in) + mock providers.
   Build: npm run build:stub -w @mitome/server; (cd apps/web && CLERK_STUB=1 npx vite build)
   Run the API from apps/server/dist-stub with WEB_DIST_DIR=apps/web/dist-stub (see README → Checks).
   pip install playwright && python -m playwright install chromium
   python scripts/ui_test.py [baseUrl]   (CHROME=/path/to/chrome to use an installed browser)"""
import os, re, sys, time, subprocess
from playwright.sync_api import sync_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
errors = []
shots = '/tmp/ui'
subprocess.run(['mkdir', '-p', shots])
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=150:d=6', '-c:a', 'libmp3lame', '/tmp/ui/bed.mp3'])

def ok(msg): print('  ✓', msg)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME') or None, args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'favicon' not in m.text else None)
    pg.goto(BASE)
    expect(pg.locator('.signin')).to_be_visible()
    assert '/sign-in' in pg.url, pg.url
    ok('signed out: the sign-in page shows')
    pg.screenshot(path=f'{shots}/01-login.png')
    email = f'ui{int(time.time())}@example.com'
    pg.fill('.clerk-stub input[name=email]', email); pg.click('.clerk-stub button')
    expect(pg.locator('#stHome')).to_be_visible()
    ok('signed up; home shows')
    pg.wait_for_timeout(500)
    pg.screenshot(path=f'{shots}/02-home.png')

    # Settings: keys are gone, server status shows.
    pg.click('#btnSettings')
    expect(pg.locator('#sElNote')).to_contain_text('connected on the server')
    assert pg.locator('input[type=password]').count() == 0  # no key fields
    pg.select_option('#sProvider', 'fal')
    expect(pg.locator('#sFalNote')).to_contain_text('connected')
    pg.screenshot(path=f'{shots}/03-settings.png')
    pg.click('#sClose')
    expect(pg.locator('#provPill')).to_contain_text('fal.ai')
    ok('settings show server status; no key fields; provider set to fal.ai')

    # Sample project → studio
    pg.click('#hSample')
    pg.wait_for_timeout(800)
    pg.click('#btnSplit')
    pg.wait_for_timeout(800)
    pg.click('#steps [data-st=studio]')
    pg.wait_for_timeout(500)
    n = pg.locator('#sceneList .srow').count()
    assert n >= 2, n
    ok(f'sample project opened with {n} scenes')

    # Generate scene 1 with (mock) fal.ai
    pg.locator('#sceneList .srow').first.click()
    pg.click('#iGenMain')
    expect(pg.locator('#sceneList .srow').first).to_contain_text('Ready', timeout=90000)
    ok('scene 1 generated through the server fal.ai job')

    # Voiceover for all scenes
    pg.click('#rail button[data-pane=voice]')
    pg.click('#btnVoAll2')
    try:
        pg.wait_for_function("() => S.scenes.every(s => !s.vo.trim() || s.voFile)", timeout=60000)
    except Exception:
        print(pg.evaluate("() => S.scenes.map(s => [s.status, s.msg, !!s.voUrl, s.voFile, s.vo.length])")); print(errors); raise
    ok('voiceovers made and stored for every scene')

    # Music bed
    pg.click('#rail button[data-pane=music]')
    pg.set_input_files('#musicFile', '/tmp/ui/bed.mp3')
    pg.wait_for_function("() => !!S.musicFile", timeout=30000)
    ok('music bed uploaded')
    pg.wait_for_function("() => document.querySelector('#savedDot').className.includes('ready')", timeout=15000)
    pg.wait_for_timeout(1500)
    pg.screenshot(path=f'{shots}/04-studio.png')
    title = pg.input_value('#title')

    # Reload: everything comes back from the server
    pg.reload()
    expect(pg.locator('#stHome')).to_be_visible()
    pg.wait_for_timeout(800)
    pg.screenshot(path=f'{shots}/04b-home-after-reload.png')
    print('   home text:', pg.inner_text('#stHome')[:600].replace('\n', ' | '))
    pg.get_by_text(title).first.click()
    pg.wait_for_timeout(2500)
    if not pg.locator('#stStudio').is_visible():
        pg.click('#steps [data-st=studio]')
    pg.wait_for_function("() => S.scenes[0] && S.scenes[0].vEl && S.music && S.scenes.filter(s => s.aEl).length > 0", timeout=30000)
    ok('after reload: clip, voiceovers and music restored from the server')
    pg.click('#btnPlay'); pg.wait_for_timeout(1500); pg.click('#btnPlay')
    pg.screenshot(path=f'{shots}/05-reloaded.png')

    # Server export
    pg.click('#btnExport')
    expect(pg.locator('#exportDlg')).to_have_class(re.compile('on'))
    pg.select_option('#exRes', '480p')
    pg.screenshot(path=f'{shots}/06-export.png')
    pg.click('#exGo')
    expect(pg.locator('#exResult a')).to_be_visible(timeout=240000)
    pg.screenshot(path=f'{shots}/07-export-done.png')
    with pg.expect_download() as dl:
        pg.click('#exResult a')
    path = dl.value.path()
    dur = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], capture_output=True, text=True).stdout.strip()
    ok(f'server export downloaded ({dl.value.suggested_filename}, {float(dur):.1f} s)')
    subprocess.run(['cp', path, f'{shots}/export.mp4'])
    pg.click('#exX')

    # Explorer lists renders
    pg.click('#exRefresh'); pg.wait_for_timeout(1200)
    kinds = pg.evaluate("() => [...new Set((S.files || []).map(f => f.kind))]")
    assert 'renders' in kinds and 'music' in kinds, kinds
    ok('explorer lists music and renders folders')

    # Sign out
    pg.click('#btnSettings'); pg.click('#sLogout')
    expect(pg.locator('.signin')).to_be_visible(timeout=10000)
    ok('signed out')
    b.close()

errs = [e for e in errors if 'Signed out' not in e and '401' not in e and 'TUNNEL' not in e]
print('page errors:', errs or 'none')
sys.exit(1 if errs else 0)
