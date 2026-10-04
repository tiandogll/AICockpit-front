"""Rendered mobile report regression; every API call uses an isolated fixture.

No login credentials, real learner records, database writes or AI calls are used.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


CODES = ['foundations', 'prompting', 'tool_use', 'evaluation', 'collaboration', 'ethics']
SESSION_ID = 'mobile-layout-fixture-session'


def responses_for(mode, open_scoring, complete=True, long_name=False):
    codes = ['collaboration'] if mode == 'specialized' else CODES
    count = 4 if mode == 'specialized' else 18
    config = {
        'dimensions': {code: 4 if mode == 'specialized' else 3 for code in codes},
        'item_type_minimums': {'objective': count - (2 if open_scoring else 0),
                               'dialogue': 2 if open_scoring else 0, 'practical': 0},
    }
    session = {
        'id': SESSION_ID, 'organization_id': 'mobile-layout-fixture-org',
        'status': 'completed', 'mode': mode, 'scenario': 'higher_education',
        'completed_at': '2026-10-03T08:00:00Z',
        'blueprint_snapshot': {'configuration': config}, 'replayed': False,
    }
    dimensions = {code: {
        'synthesis': {'index': 72.6, 'level': 'L4', 'evidence_count': 4},
        'objective_measurement': {'theta': 0.975, 'standard_error': 0.4,
                                  'evidence_count': 4, 'level': 'L4'},
    } for code in codes}
    if open_scoring:
        dimensions[codes[0]]['rubric_measurement'] = {
            'completed': 2 if complete else 0, 'pending': 0 if complete else 2, 'decisions': [],
        }
    report = {
        'id': 'mobile-layout-fixture-report', 'session_id': SESSION_ID,
        'is_complete': complete, 'revision': 3,
        'payload': {
            'assessment': {'mode': mode, 'scenario': 'higher_education',
                           'blueprint': {'configuration': config}},
            'measurement_status': 'complete' if complete else 'pending_scoring',
            'summary': {'answered': count, 'pending_scoring': 0 if complete else 2,
                        'needs_review': 0,
                        'scored_open_answers': 2 if open_scoring and complete else 0},
            'dimensions': dimensions, 'recommendations': [],
        },
    }
    items = [{'item_version_id': f'mobile-layout-item-{n}', 'sequence': n + 1,
              'item_type': 'dialogue' if open_scoring and n >= count - 2 else 'objective',
              'dimension_code': codes[n % len(codes)],
              'answered_at': '2026-10-03T08:00:00Z', 'flagged': False}
             for n in range(count)]
    return {
        '/health': {'status': 'ok'},
        '/auth/me': {'id': 'mobile-layout-fixture-user', 'username': 'mobile-layout-fixture',
                     'display_name': ('界面测试学员的超长显示名称' * 6)[:80] if long_name else '界面测试学员',
                     'email': None, 'is_active': True},
        '/workspace/access': {'organizations': [{
            'id': session['organization_id'], 'name': '界面测试组织',
            'role': 'learner', 'capabilities': [],
        }], 'global_capabilities': []},
        '/workspace/features': {'training_enabled': True,
                                'training_content_status': 'formative_preview',
                                'growth_guide_mode': 'deepseek', 'attachments_enabled': False},
        f'/reports/{SESSION_ID}': report,
        f'/sessions/{SESSION_ID}': session,
        '/training': {'items': [], 'total': 0, 'limit': 1, 'offset': 0},
        f'/sessions/{SESSION_ID}/workspace': {'session': session, 'items': items,
                                             'answered_count': count, 'max_items': count},
    }, count


def assert_geometry(frame):
    metrics = frame.evaluate('''() => {
        const rect = el => {
            const r = el.getBoundingClientRect();
            return {x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom};
        };
        const summary = document.querySelector('.report-summary');
        const grid = summary.querySelector('dl');
        const style = getComputedStyle(summary);
        const profile = document.querySelector('.profile-card');
        const evidence = document.querySelector('.report-evidence');
        return {
            summary:rect(summary), grid:rect(grid),
            innerWidth:summary.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
            cells:[...grid.children].map(rect),
            columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,
            values:[...grid.querySelectorAll('dd')].map(el => ({
                ...rect(el), lineHeight:parseFloat(getComputedStyle(el).lineHeight),
                overflows:el.scrollWidth > el.clientWidth + 1,
            })),
            profile:rect(profile), evidence:rect(evidence),
            gap:parseFloat(getComputedStyle(document.querySelector('.report-main')).rowGap),
            overflow:document.documentElement.scrollWidth > innerWidth + 1,
            contentOverflow:document.querySelector('.mobile-content').scrollWidth
                > document.querySelector('.mobile-content').clientWidth + 1,
        };
    }''')
    assert abs(metrics['grid']['width'] - metrics['innerWidth']) <= 2, metrics
    assert all(cell['width'] >= 82 for cell in metrics['cells']), metrics
    assert all(value['height'] <= value['lineHeight'] + 1 for value in metrics['values']), metrics
    assert all(not value['overflows'] for value in metrics['values']), metrics
    assert metrics['columns'] == (2 if len(metrics['cells']) == 4 else 3), metrics
    if len(metrics['cells']) == 4:
        assert metrics['cells'][2]['y'] > metrics['cells'][0]['bottom'], metrics
    assert metrics['summary']['height'] < 360, metrics
    assert abs(metrics['evidence']['y'] - metrics['profile']['bottom'] - metrics['gap']) <= 2, metrics
    assert not metrics['overflow'] and not metrics['contentOverflow'], metrics
    return metrics


def run_case(browser, args, width, mode, open_scoring, complete=True, long_name=False):
    context = browser.new_context(viewport={'width': width, 'height': 950}, has_touch=True)
    responses, count = responses_for(mode, open_scoring, complete, long_name)
    errors, unexpected, writes = [], [], []
    context.add_init_script('''sessionStorage.setItem('zhijian-auth-session',
        JSON.stringify({accessToken:'isolated-mobile-fixture',refreshToken:'isolated-mobile-fixture'}));''')

    def intercept(route):
        path = urlparse(route.request.url).path.removeprefix('/api/v1')
        if route.request.method != 'GET':
            writes.append(path)
        data = responses.get(path)
        if data is None:
            unexpected.append(path)
            route.fulfill(status=404, json={'detail': 'Outside isolated mobile layout fixture'})
        else:
            route.fulfill(json=data)

    context.route('**/api/v1/**', intercept)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(f'{args.base_url}/reports/{SESSION_ID}', wait_until='networkidle')
        frame = page
        if width > 700:
            frame = page.locator('.phone-preview').element_handle().content_frame()
            frame.wait_for_load_state('networkidle')
        frame.locator('.report-evidence').wait_for()
        name = f'report-{width}-{mode}-{"mixed" if open_scoring else "objective"}'
        if not complete:
            name += '-pending'
        if long_name:
            name += '-long-name'
        metrics = assert_geometry(frame)
        page.screenshot(path=str(args.output / f'{name}.png'))
        assert frame.locator('[data-testid=open-scoring-progress]').count() == int(open_scoring)
        assert frame.locator('.status-pill.pending').count() == int(not complete)
        frame.get_by_role('button', name='评分过程', exact=True).click()
        assert_geometry(frame)
        frame.get_by_role('button', name=f'全部回答 {count}', exact=True).click()
        assert frame.locator('.answers-table').evaluate('el => el.scrollWidth <= el.clientWidth + 1')
        frame.locator('.report-evidence').evaluate('''el => {
            const content = document.querySelector('.mobile-content');
            content.scrollTop += el.getBoundingClientRect().top - content.getBoundingClientRect().top - 12;
        }''')
        page.screenshot(path=str(args.output / f'{name}-evidence.png'))
        assert not errors and not writes and not unexpected, (errors, writes, unexpected)
        print(json.dumps({'case': name, 'summary_height': metrics['summary']['height'],
                          'metric_widths': [cell['width'] for cell in metrics['cells']],
                          'script_errors': len(errors), 'api_writes': len(writes)}, ensure_ascii=False))
    finally:
        context.close()


def run_session_route(browser, args, width):
    """Browser history A→B must mount a new runner and load B's workspace."""
    context = browser.new_context(viewport={'width': width, 'height': 950}, has_touch=True)
    responses, _ = responses_for('specialized', False)
    calls, errors = [], []
    for identifier in ('mobile-route-a', 'mobile-route-b'):
        item_id = identifier + '-item'
        item = {'session_id': identifier, 'item_version_id': item_id, 'sequence': 1,
                'item_type': 'objective', 'dimension_code': 'collaboration', 'difficulty': 0,
                'stem': f'{identifier}：请选择完成任务后的核验步骤。',
                'configuration': {'options': ['核对原始依据', '直接使用']}}
        responses[f'/sessions/{identifier}/workspace'] = {
            'session': {'id': identifier, 'organization_id': 'mobile-layout-fixture-org',
                        'blueprint_version_id': 'mobile-fixture-bp', 'status': 'active',
                        'mode': 'rapid', 'scenario': 'higher_education',
                        'blueprint_snapshot': {}, 'replayed': False},
            'server_now': '2026-10-03T08:00:00Z', 'blueprint_name': identifier,
            'min_items': 2, 'max_items': 5, 'answered_count': 0, 'dispatched_count': 1,
            'flagged_count': 0, 'current_item': item,
            'items': [{'item_version_id': item_id, 'sequence': 1,
                       'item_type': 'objective', 'dimension_code': 'collaboration',
                       'answered_at': None, 'flagged': False}],
            'type_coverage': [{'item_type': 'objective', 'answered_count': 0, 'minimum': 2}],
            'can_complete': False, 'completion_reason': 'insufficient',
            'unmet_dimensions': [], 'unmet_item_types': [],
        }
        responses[f'/sessions/{identifier}/items/{item_id}/draft'] = {
            'draft': None, 'context_revision': 0, 'can_edit': True,
        }
    context.add_init_script('''sessionStorage.setItem('zhijian-auth-session',
        JSON.stringify({accessToken:'isolated-mobile-fixture',refreshToken:'isolated-mobile-fixture'}));''')

    def intercept(route):
        path = urlparse(route.request.url).path.removeprefix('/api/v1')
        calls.append((route.request.method, path))
        assert route.request.method == 'GET' and path in responses, calls
        route.fulfill(json=responses[path])

    context.route('**/api/v1/**', intercept)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(args.base_url + '/assessment/mobile-route-a', wait_until='networkidle')
        frame = page if width <= 700 else page.locator('.phone-preview').element_handle().content_frame()
        frame.wait_for_load_state('networkidle')
        frame.locator('.exam-objective h1').filter(has_text='mobile-route-a').wait_for()
        marker = len(calls)
        frame.evaluate('''() => {
            history.pushState(history.state, '', '/assessment/mobile-route-b');
            dispatchEvent(new PopStateEvent('popstate', {state:history.state}));
        }''')
        frame.locator('.exam-objective h1').filter(has_text='mobile-route-b').wait_for()
        frame.wait_for_load_state('networkidle')
        later = calls[marker:]
        assert any(path == '/sessions/mobile-route-b/workspace' for _, path in later), later
        assert not any('/sessions/mobile-route-a/' in path for _, path in later), later
        assert frame.locator('.bottom-tabs').count() == 0
        assert not errors, errors
        page.screenshot(path=str(args.output / f'session-route-{width}-b.png'))
        print(json.dumps({'case': f'session-route-{width}-a-to-b',
                          'workspace_b_loaded': True, 'stale_workspace_a_requests': 0,
                          'script_errors': 0, 'api_writes': 0}))
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:5174')
    parser.add_argument('--output', type=Path, default=Path('output/mobile-report-layout'))
    parser.add_argument('--sessions-only', action='store_true',
                        help='Only verify in-app A→B assessment navigation')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
        try:
            if not args.sessions_only:
                for width in (360, 390, 460, 1440):
                    for mode, mixed in (('specialized', False), ('standard', False), ('standard', True)):
                        run_case(browser, args, width, mode, mixed)
                    for complete in (True, False):
                        run_case(browser, args, width, 'standard', True,
                                 complete=complete, long_name=True)
            for width in (390, 1440):
                run_session_route(browser, args, width)
        finally:
            browser.close()


if __name__ == '__main__':
    main()
