"""Compact mobile visual regression using isolated, read-only browser fixtures.

All API requests fail closed in compact_fixtures. No real account, answer,
training record, export or paid AI request is created by this test.
--baseline removes only the four shared compact CSS modules in the test DOM.
It compares those styles using identical content/viewport, but does not revert
the independent mobile assessment template or its own scoped stylesheet.
"""
import argparse
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright
from compact_fixtures import install_fixtures, PLAN_ID, SESSION_ID, PENDING_SESSION_ID


def prepare(frame, baseline):
    if baseline:
        frame.evaluate(r"""() => {
          for (const style of document.querySelectorAll('style[data-vite-dev-id]')) {
            if (/(?:compact|assessment-compact|reports-compact|training-compact)\.css$/.test(style.dataset.viteDevId)) style.remove();
          }
        }""")


def fit(frame, selector='.mobile-content'):
    assert not frame.evaluate('document.documentElement.scrollWidth > innerWidth + 1')
    assert frame.locator(selector).evaluate('el => el.scrollWidth <= el.clientWidth + 1'), selector


def reveal(frame, selector):
    target = frame.locator(selector).first.evaluate("""el => {
      const viewport = document.querySelector('.mobile-content');
      viewport.style.scrollBehavior = 'auto';
      const target = Math.min(viewport.scrollHeight - viewport.clientHeight,
        Math.max(0, viewport.scrollTop + el.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12));
      viewport.scrollTop = target;
      return target;
    }""")
    frame.wait_for_function("target => Math.abs(document.querySelector('.mobile-content').scrollTop - target) <= 1", arg=target)


def measure(frame, selectors):
    return {name: frame.locator(selector).first.evaluate('el => Math.round(el.getBoundingClientRect().height)')
            for name, selector in selectors.items()}


def check_case(browser, args, width):
    context = browser.new_context(viewport={'width': width, 'height': 900}, has_touch=True,
                                  reduced_motion='reduce')
    state, errors = {'plans': False}, []
    install_fixtures(context, state)
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    metrics = {'width': width, 'baseline': args.baseline}
    try:
        def navigate(path, ready):
            page.goto(args.base_url + path, wait_until='networkidle')
            frame = page
            if width > 700:
                frame = page.locator('.phone-preview').element_handle().content_frame()
                frame.wait_for_load_state('networkidle')
            frame.locator(ready).first.wait_for()
            prepare(frame, args.baseline)
            fit(frame)
            return frame

        def capture(label):
            page.screenshot(path=str(args.output / f'{width}-{label}.png'))

        frame = navigate('/assessment', '[data-testid="mode-standard"]')
        capture('assessment')
        heights = frame.locator('[data-testid^="mode-"]').evaluate_all('els => els.map(el => Math.round(el.getBoundingClientRect().height))')
        metrics['mode_heights'] = heights
        mobile_layout = frame.locator('[data-testid="mobile-assessment"]').count() > 0
        if mobile_layout:
            metrics.update(measure(frame, {'launch_panel': '.m-assess-launch'}))
            if not args.baseline:
                assert max(heights) <= 120, heights
                assert metrics['launch_panel'] < 300, metrics
                assert frame.get_by_test_id('start-assessment').evaluate("el => el.getBoundingClientRect().bottom <= document.querySelector('.mobile-content').getBoundingClientRect().bottom"), 'Start should fit in the first 900px viewport'
        else:
            metrics.update(measure(frame, {'configuration': '.configuration-card', 'launch_preview': '.launch-preview'}))
        for mode in ('rapid', 'specialized', 'fixed', 'standard'):
            frame.get_by_test_id('mode-' + mode).click()
            expect(frame.get_by_test_id('mode-' + mode)).to_have_attribute('aria-pressed', 'true')
            assert frame.url.split('?')[0].endswith('/assessment'), 'Mode selection must not start'
            expect(frame.get_by_test_id('start-assessment')).to_be_enabled()
            fit(frame)
        reveal(frame, '.m-assess-launch' if mobile_layout else '.launch-grid')
        capture('assessment-launch')
        details = frame.locator('.m-assess-rules' if mobile_layout else '.dimension-details')
        details.locator('summary').click()
        assert details.get_attribute('open') is not None
        fit(frame)

        frame = navigate('/reports', '.report-card')
        capture('reports')
        metrics.update(measure(frame, {'report_card': '.report-card', 'report_filters': '.filter-panel'}))
        if not args.baseline:
            assert metrics['report_card'] < 290, metrics
        frame.get_by_test_id('mode-filter').select_option('specialized')
        expect(frame.locator('.empty-state')).to_be_visible()
        frame.get_by_test_id('mode-filter').select_option('')
        expect(frame.locator('.report-card')).to_have_count(2)

        frame = navigate('/reports/' + SESSION_ID, '.report-evidence')
        capture('report-detail')
        metrics.update(measure(frame, {'report_summary': '.report-summary', 'report_profile': '.profile-card'}))
        if not args.baseline:
            # Four facts may intentionally reflow into two readable rows.
            # The old summary was ~332px tall; neither layout should regain it.
            assert metrics['report_summary'] < 245, metrics
            assert metrics['report_profile'] < 420, metrics
        frame.get_by_role('button', name='分享报告', exact=True).click()
        fit(frame, '.report-dialog[open]')
        capture('report-share')
        frame.get_by_role('button', name='关闭分享').click()
        # In the real business view, sufficient final evidence links directly
        # to plan generation. Advice is the alternate state when training is
        # unavailable, rather than a dialog for every .training-button.
        state['training_enabled'] = False
        frame = navigate('/reports/' + SESSION_ID, '.report-evidence')
        frame.locator('.training-button').click()
        fit(frame, '.advice-dialog[open]')
        capture('report-advice')
        frame.get_by_role('button', name='关闭提升建议').click()
        state['training_enabled'] = True
        frame = navigate('/reports/' + SESSION_ID, '.report-evidence')
        reveal(frame, '.report-evidence')
        frame.get_by_role('button', name='查看证据', exact=True).first.click()
        fit(frame, '.evidence-dialog[open]')
        capture('report-evidence-dialog')
        frame.get_by_role('button', name='关闭证据详情').click()
        frame.get_by_role('button', name='评分过程', exact=True).click()
        fit(frame)
        capture('report-process')
        frame.get_by_role('button', name='全部回答 12', exact=True).click()
        expect(frame.locator('.answers-table')).to_be_visible()
        fit(frame)
        capture('report-answers')
        frame.get_by_role('button', name='查看原回答', exact=True).first.click()
        expect(frame.locator('.evidence-dialog h3')).to_be_visible()
        fit(frame, '.evidence-dialog[open]')
        capture('report-original-answer')
        frame.get_by_role('button', name='关闭证据详情').click()

        frame = navigate('/reports/' + PENDING_SESSION_ID, '.report-evidence')
        assert '等待人工复核' in frame.locator('.status-pill').inner_text()
        assert '尚未定稿' in frame.locator('.inline-notice').first.inner_text()
        capture('report-pending')

        frame = navigate('/training?view=library', '.study-grid article')
        capture('training-library')
        metrics['study_card'] = frame.locator('.study-grid article').evaluate_all('els => Math.max(...els.map(el => Math.round(el.getBoundingClientRect().height)))')
        if not args.baseline:
            assert metrics['study_card'] < 170, metrics
        frame.get_by_role('button', name='阅读方法：基础认知', exact=True).click()
        fit(frame, '.study-dialog[open]')
        capture('training-method')
        frame.get_by_role('button', name='关闭学习方法').click()

        frame = navigate('/training', '.personal-empty')
        capture('training-create')
        reveal(frame, '.create-panel')
        capture('training-source')
        fit(frame)

        state['plans'] = True
        frame = navigate('/training?plan=' + PLAN_ID, '.training-overview')
        capture('training-plan')
        metrics.update(measure(frame, {'training_target': '.target-band', 'training_tasks': '.today-panel'}))
        if not args.baseline:
            assert metrics['training_target'] < 350, metrics
        reveal(frame, '.today-panel')
        capture('training-tasks')
        frame.locator('.overview-task-row').first.get_by_role('button', name='回顾').click()
        expect(frame.locator('.training-review-dialog[open]')).to_be_visible()
        fit(frame, '.training-review-dialog[open]')
        capture('training-review')
        frame.locator('.training-review-dialog[open]').press('Escape')
        frame.locator('.overview-primary').click()
        expect(frame.locator('#current-training-task')).to_be_visible()
        reveal(frame, '#current-training-task')
        fit(frame)
        capture('training-current-task')

        assert not errors, errors
        assert not state['unexpected'], state['unexpected']
        assert all(request.startswith(('GET ', 'HEAD ')) for request in state['requests'])
        metrics['script_errors'] = len(errors)
        metrics['api_writes'] = 0
        print(json.dumps(metrics, ensure_ascii=False))
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:5174')
    parser.add_argument('--output', type=Path, default=Path('output/mobile-compact-layout'))
    parser.add_argument('--baseline', action='store_true')
    parser.add_argument('--width', type=int, action='append', help='Default: 360, 390, 460 and centered desktop phone')
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
        try:
            for width in args.width or (360, 390, 460, 1440):
                check_case(browser, args, width)
        finally:
            browser.close()


if __name__ == '__main__':
    main()
