"""Create a REAL old-format backup: import messy files with the pre-V2.5 engine (v241), then download its backup."""
import json, sys
from playwright.sync_api import sync_playwright
OUT = sys.argv[1]
def blk(no, **kw):
    f = dict(SOURCE_QUESTION_NO=no, EXAM_NAME='RRB NTPC', YEAR='2023', SUBJECT='Maths', CHAPTER='Arithmetic', TOPIC='Ratio Old', QUESTION_EN=f'Old ratio question {no}?', A_EN=str(no), B_EN=str(no + 1), C_EN=str(no + 2), D_EN=str(no + 3), ANSWER='B')
    f.update(kw)
    return '=== QUESTION START ===\n' + '\n'.join(f'{k}: {v}' for k, v in f.items() if v is not None) + '\n=== QUESTION END ===\n'
files = {
  # clean-ish file with a few classic problems
  'Ratio Old': ''.join([blk(1), blk(2, ANSWER='(C)'), blk(3, EXPLANATION_EN='Step 1\nA: stray line goes to Hindi A'), blk(4, PAPER=None), blk(5, ANSWER='b')]),
  # exam name misread by the old engine
  'Mixture Old': ''.join(blk(i, EXAM_NAME='SSC MTS Objective', TOPIC='Mixture Old', QUESTION_EN=f'Mixture q {i}?') for i in range(1, 4)),
  # file without EXAM_NAME / YEAR → old engine invented "Railway Official PYQ" + 2024
  'Average Old': ''.join(blk(i, EXAM_NAME=None, YEAR=None, TOPIC='Average Old', QUESTION_EN=f'Average q {i}?') for i in range(1, 4)),
}
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(accept_downloads=True); pg = ctx.new_page()
    pg.on('dialog', lambda d: d.accept())
    pg.goto('file:///home/claude/work/v241.html'); pg.wait_for_selector('.sj-dash')
    for topic, txt in files.items():
        r = pg.evaluate("async ([t,topic])=>{const a=await ImportEngine.analyzeTxt(new File([t],'f.txt'),topic);if(!a.commitReady)return {ok:false,e:a.validationErrors};const c=await ImportEngine.commit(a);return {ok:true,n:c.committedQuestions}}", [txt, topic])
        print(topic, r)
    with pg.expect_download() as d: pg.evaluate("downloadDataSnapshot()")
    d.value.save_as(OUT)
    data = json.load(open(OUT))
    for m in data['modules']:
        if 'old' in m['moduleId']:
            q = m['groups'][0]['questions'][0]
            print(m['moduleId'], m.get('examId'), m.get('examYear'), '| q:', q['examInfo'], q['year'], q['paperDate'], q['metadata']['examId'], q['metadata']['subtopic'], q['answer'])
    b.close()
