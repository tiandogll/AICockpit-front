"""Mobile presentation checks; no answer is submitted.

Optional real login uses AI_MEASURE_CHECK_ACCOUNT / AI_MEASURE_CHECK_PASSWORD
from the process environment, never from a source file or saved browser state.
--exercise-assessment creates a session only in a disposable local account.
--check-ai makes one real, potentially billable DeepSeek request in that account.
"""
import argparse
import json
import os
import secrets
import sys
import subprocess
from uuid import uuid4
from urllib.request import Request, urlopen
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def disable_test_account(identifier: str, account: str) -> None:
    """Disable only the exact account created by this run; never delete records."""
    api = Path(__file__).resolve().parents[2] / 'api'
    # Playwright owns an event loop even through its synchronous API. Isolate
    # database cleanup in its own process, with no browser state or credentials.
    code = '''
import asyncio, sys
from sqlalchemy import text
from app.db.session import engine
async def disable():
    async with engine.begin() as connection:
        result = await connection.execute(
            text("UPDATE users SET is_active = false WHERE id = :id AND username = :username AND display_name = :name"),
            {"id": sys.argv[1], "username": sys.argv[2], "name": "手机界面验证账号"},
        )
        assert result.rowcount == 1
    await engine.dispose()
asyncio.run(disable())
'''
    subprocess.run([sys.executable, '-X', 'utf8', '-c', code, identifier, account], cwd=api, check=True)
    print('Disposable local UI account disabled; no existing account was changed.')


def check_authenticated(browser, args, account: str, password: str) -> dict:
    context = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True)
    try:
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(args.base_url + '/login', wait_until='networkidle')
        page.get_by_label('用户名或邮箱', exact=True).fill(account)
        page.get_by_label('密码', exact=True).fill(password)
        page.locator('.auth-card button[type=submit]').click()
        page.wait_for_url('**/workspace', timeout=20000)
        page.wait_for_load_state('networkidle')
        page.get_by_test_id('mobile-home').wait_for()
        assert not page.get_by_role('alert').count()
        page.screenshot(path=str(args.output / 'authenticated-home.png'))
        for route in ('/assessment', '/reports', '/training', '/history', '/profile'):
            page.goto(args.base_url + route, wait_until='networkidle')
            page.locator('.mobile-content').wait_for()
            assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 1'), route
            assert page.locator('.mobile-content').evaluate('e => e.scrollWidth <= e.clientWidth + 1'), route
            assert not page.get_by_role('alert').count(), route
            page.screenshot(path=str(args.output / f'authenticated-{route[1:]}.png'))
            if route == '/assessment':
                before = page.url
                page.get_by_test_id('mode-rapid').click()
                assert page.url == before, 'Selecting a mode must not start a session'
                assert page.get_by_test_id('mode-rapid').get_attribute('aria-pressed') == 'true'
                assert page.get_by_test_id('start-assessment').is_enabled()
            if route == '/profile':
                for width in (360, 390, 460):
                    page.set_viewport_size({'width': width, 'height': 844})
                    assert page.locator('.mobile-content').evaluate('e => e.scrollWidth <= e.clientWidth + 1')
                    page.wait_for_function("""() => {
                        const robot = document.querySelector('[data-testid=mobile-robot]')?.getBoundingClientRect();
                        return robot && robot.x >= 0 && robot.right <= innerWidth + 1;
                    }""")
                    page.screenshot(path=str(args.output / f'profile-{width}.png'))
                page.set_viewport_size({'width': 390, 'height': 844})
                page.get_by_role('button', name='个人资料与账号安全').click()
                assert page.locator('dialog.profile-dialog[open]').count() == 1
                page.screenshot(path=str(args.output / 'authenticated-profile-dialog.png'))
                page.locator('.close-profile').click()
        page.goto(args.base_url + '/reports', wait_until='networkidle')
        robot = page.get_by_test_id('mobile-robot')
        robot.wait_for()
        assert robot.evaluate('e => getComputedStyle(e).backgroundColor') == 'rgba(0, 0, 0, 0)'
        assert robot.evaluate('e => getComputedStyle(e).boxShadow') == 'none'
        start = robot.bounding_box()
        page.mouse.move(start['x'] + start['width'] / 2, start['y'] + start['height'] / 2)
        page.mouse.down()
        page.mouse.move(90, 220, steps=12)
        page.mouse.up()
        assert not page.locator('.mobile-assistant-sheet[open]').count(), 'Dragging must not open the assistant'
        page.wait_for_function("JSON.parse(localStorage.getItem('ai-measure-mobile-robot-position-v1') || 'null')?.x < 0.5")
        moved = robot.bounding_box()
        assert moved['y'] < start['y'] - 100
        page.get_by_role('link', name='训练', exact=True).click()
        page.wait_for_load_state('networkidle')
        assert abs(robot.bounding_box()['x'] - moved['x']) < 3, 'Keep the robot position across page changes'
        page.reload(wait_until='networkidle')
        robot.wait_for()
        assert abs(robot.bounding_box()['x'] - moved['x']) < 3, 'Restore the position after refresh'
        robot.focus()
        before_key = robot.bounding_box()['x']
        robot.press('ArrowRight')
        expect(robot).not_to_have_class('is-moving')
        page.wait_for_function("JSON.parse(localStorage.getItem('ai-measure-mobile-robot-position-v1')).x > 0.15")
        assert robot.bounding_box()['x'] >= before_key
        touch = context.new_cdp_session(page)
        box = robot.bounding_box()
        scroll_before = page.locator('.mobile-content').evaluate('e => e.scrollTop')
        touch.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': box['x'] + 35, 'y': box['y'] + 35, 'id': 1}]})
        touch.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': 250, 'y': 520, 'id': 1}]})
        touch.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        touch.detach()
        page.wait_for_function("JSON.parse(localStorage.getItem('ai-measure-mobile-robot-position-v1')).x > 0.6")
        assert page.locator('.mobile-content').evaluate('e => e.scrollTop') == scroll_before
        assert not page.locator('.mobile-assistant-sheet[open]').count(), 'Touch dragging must not send a click'
        page.emulate_media(reduced_motion='reduce')
        page.wait_for_function("matchMedia('(prefers-reduced-motion: reduce)').matches")
        page.wait_for_function("getComputedStyle(document.querySelector('[data-testid=mobile-robot]')).transitionDuration.split(',').every(v => parseFloat(v) <= 0.00001)")
        page.screenshot(path=str(args.output / 'robot-transparent-drag.png'))
        page.get_by_role('button', name='打开成长助手', exact=True).click()
        assert page.get_by_role('dialog', name='成长助手', exact=True).is_visible()
        if args.check_ai:
            field = page.get_by_role('textbox', name='向成长助手提问', exact=True)
            expect(field).to_be_enabled(timeout=15000)
            field.fill('用一句话说明如何开始测评，不需要读取任何个人报告。')
            with page.expect_response(lambda response: '/api/v1/workspace/guide' in response.url and response.request.method == 'POST' and not response.url.endswith('/materials'), timeout=60000) as received:
                page.get_by_role('button', name='发送问题', exact=True).click()
            reply = received.value
            assert reply.ok, f'Growth request failed: HTTP {reply.status}'
            generated = reply.json()
            assert generated['mode'] == 'deepseek'
            assert generated['generation']['status'] == 'succeeded'
            assert generated['generation']['requested_provider'] == 'deepseek'
            expect(page.get_by_test_id('guide-turn')).to_be_visible(timeout=10000)
            print(json.dumps({'live_ai': 'passed', 'model': generated['generation']['model'], 'total_tokens': generated['generation']['usage']['total_tokens']}, ensure_ascii=False))
        page.screenshot(path=str(args.output / 'authenticated-assistant.png'))
        page.get_by_role('button', name='使用说明', exact=True).click()
        page.get_by_role('link', name='查看完整使用指南 →', exact=True).click()
        page.wait_for_url('**/help')
        expect(page.get_by_role('dialog', name='成长助手', exact=True)).not_to_be_visible()

        if args.exercise_assessment:
            page.goto(args.base_url + '/assessment?mode=rapid', wait_until='networkidle')
            page.get_by_test_id('start-assessment').click()
            page.wait_for_url('**/assessment/*', timeout=20000)
            page.wait_for_load_state('networkidle')
            page.locator('.exam-objective fieldset label').first.wait_for()
            assert not page.locator('.bottom-tabs').count(), 'Hide bottom tabs during a formal assessment'
            coverage = page.get_by_test_id('assessment-coverage').inner_text()
            assert '客观题' in coverage and '对话' not in coverage and '实操' not in coverage
            for width in (360, 390, 460):
                page.set_viewport_size({'width': width, 'height': 844})
                assert not page.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
                assert page.locator('.mobile-content').evaluate('e => e.scrollWidth <= e.clientWidth + 1')
                page.screenshot(path=str(args.output / f'answering-{width}.png'))
            page.get_by_role('button', name='暂存退出', exact=True).click()
            page.wait_for_url('**/workspace', timeout=20000)
            page.wait_for_load_state('networkidle')
            page.goto(args.base_url + '/profile', wait_until='networkidle')
            expect(page.locator('.acct-passport-stats > a').nth(1).locator('strong')).to_contain_text('1')
            expect(page.locator('.acct-next-card')).to_contain_text('继续作答')
            page.screenshot(path=str(args.output / 'profile-with-active-assessment.png'))
            page.locator('.acct-next-card').click()
            page.wait_for_url('**/assessment/*', timeout=20000)
            page.get_by_test_id('assessment-paused').wait_for()
            page.get_by_test_id('resume-assessment').click()
            page.locator('.exam-objective fieldset label').first.wait_for()
            page.get_by_role('button', name='暂存退出', exact=True).click()
            page.wait_for_url('**/workspace', timeout=20000)
            page.wait_for_load_state('networkidle')
        assert not errors, errors
        return {'real_login': 'passed', 'business_pages': 'passed', 'transparent_robot_drag_persistence': 'passed', 'mode_selection_only': 'passed', 'rapid_start_pause_resume': 'passed' if args.exercise_assessment else 'not_requested', 'live_ai': 'passed' if args.check_ai else 'not_requested', 'script_errors': 0}
    finally:
        context.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default='http://127.0.0.1:5174')
    parser.add_argument('--output', type=Path, default=Path('output/mobile-ui'))
    parser.add_argument('--register-test-account', action='store_true', help='Create one disposable local learner, then disable it after testing')
    parser.add_argument('--exercise-assessment', action='store_true', help='Start, pause and resume one rapid assessment without submitting answers; requires a disposable account')
    parser.add_argument('--check-ai', action='store_true', help='Make one real, potentially billable DeepSeek growth request; requires a disposable account')
    args = parser.parse_args()
    if args.exercise_assessment and not args.register_test_account:
        parser.error('--exercise-assessment requires --register-test-account, never an existing account')
    if args.check_ai and not args.register_test_account:
        parser.error('--check-ai requires --register-test-account, never an existing account')
    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=True, executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe'
        )
        for width in (360, 390, 460, 1440):
            context = browser.new_context(viewport={'width': width, 'height': 950})
            page = context.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(args.base_url, wait_until='networkidle')
            app = page.frames[-1]
            app.get_by_test_id('mobile-home').wait_for()
            assert app.locator('.bottom-tabs a').count() == 5
            assert not app.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
            assert app.locator('.mobile-content').evaluate('e => e.scrollWidth <= e.clientWidth + 1')
            page.screenshot(path=str(args.output / f'home-{width}.png'))
            app.get_by_role('button', name='更多功能', exact=True).click()
            assert app.get_by_role('dialog', name='更多功能', exact=True).is_visible()
            app.get_by_role('button', name='关闭更多功能', exact=True).click()
            app.locator('.hero-primary').click()
            app.wait_for_url('**/login?**')
            app.wait_for_load_state('networkidle')
            assert app.get_by_label('用户名或邮箱', exact=True).is_visible()
            assert 'login' in page.url
            app.locator('.auth-card button[type=submit]').click()
            assert app.get_by_role('alert').count() == 1
            assert not app.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
            page.screenshot(path=str(args.output / f'login-{width}.png'))
            app.get_by_role('link', name='注册学员账号', exact=True).click()
            app.wait_for_url('**/register?**')
            app.wait_for_load_state('networkidle')
            assert not app.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
            page.screenshot(path=str(args.output / f'register-{width}.png'))
            assert not errors, errors
            results.append({'width': width, 'public_navigation': 'passed', 'script_errors': 0})
            context.close()

        account, password = os.environ.get('AI_MEASURE_CHECK_ACCOUNT'), os.environ.get('AI_MEASURE_CHECK_PASSWORD')
        created = None
        if args.register_test_account:
            if args.base_url != 'http://127.0.0.1:5174':
                raise ValueError('Disposable registration is only enabled against the local mobile service')
            account, password = 'mobile.check.' + uuid4().hex[:12], secrets.token_urlsafe(24)
            payload = json.dumps({'username': account, 'password': password, 'display_name': '手机界面验证账号'}).encode()
            request = Request(args.base_url + '/api/v1/auth/register', data=payload, headers={'Content-Type': 'application/json'}, method='POST')
            with urlopen(request, timeout=15) as response:
                created = json.load(response)
        try:
            if account and password:
                results.append(check_authenticated(browser, args, account, password))
        finally:
            browser.close()
            if created:
                disable_test_account(created['id'], account)
    print(json.dumps(results, ensure_ascii=False))


if __name__ == '__main__':
    main()
