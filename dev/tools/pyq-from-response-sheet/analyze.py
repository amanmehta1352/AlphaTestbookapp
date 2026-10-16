import json, glob, os
from playwright.sync_api import sync_playwright
out = {'topics': [], 'questions': [], 'exams': {}, 'warnings': {}, 'errors': {}}
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('file:///home/claude/alphatestbookapp/index.html'); pg.wait_for_selector('.sj-dash', timeout=20000)
    for f in sorted(glob.glob('txt/*.txt')):
        txt = open(f, encoding='utf-8').read()
        r = pg.evaluate("""async ([t,name])=>{AppModules=[];const a=await ImportEngine.analyzeTxt(new File([t],name),'',{});
          if(!a.commitReady) return {ok:false, errors:a.validationErrors, dup:[a.duplicateBatch,a.duplicateExternal]};
          const mod=studioModFromAnalysis(a); const rows=[], probs=[];
          a.questions.forEach(q=>{const r=srvQuestionRow(q,mod); if(r.problems.length) probs.push([q.originalQNo,r.problems]); else rows.push(r.row);});
          const exams={}; [srvTopicRow(mod).exam_id,...rows.map(r=>r.exam_id)].filter(Boolean).forEach(e=>{exams[e]=srvExamRow(e,a.questions[0].metadata.exam)});
          return {ok:true, topic:srvTopicRow(mod), rows, probs, exams, warnings:a.warnings};}""", [txt, os.path.basename(f)])
        if not r['ok']: out['errors'][f] = r; continue
        out['topics'].append(r['topic']); out['questions'] += r['rows']; out['exams'].update(r['exams'])
        if r['warnings']: out['warnings'][f] = r['warnings']
        assert not r['probs'], r['probs']
    b.close()
print('errors', json.dumps(out['errors'], ensure_ascii=False)[:1500])
print('topics', len(out['topics']), 'questions', len(out['questions']), 'exams', list(out['exams']))
print('page errors', errs[:3])
ws = [w for v in out['warnings'].values() for w in v]
print('warnings', len(ws)); [print(' ', w[:160]) for w in ws[:25]]
json.dump(out, open('server_rows.json', 'w'), ensure_ascii=False)
