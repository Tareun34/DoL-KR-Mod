# 영문 0.5.13.8 추종 2단계(번역) 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 0.5.13.8 병합으로 영어가 된 자리(옛 번역이 밀려난 2,547건 → 새 영문 371건 → 새 파일 27개)를 번역 에이전트가 파일 묶음 단위로 한글화하고, 구조 검사·빌드·커밋을 거쳐 서버에 바로 반영한다.

**Architecture:** 조율자(이 세션)는 번역하지 않는다. `tools/translation_batches.py`가 묶음 목록을 만들고, 묶음마다 번역 서브에이전트(가장 강한 모델)가 `translation/TRANSLATOR.md` 지침으로 파일을 고친다. `tools/check_translation.py`가 번역 전(git HEAD)과 후의 구조 스켈레톤을 비교해 코드가 바뀌지 않았음을 보장하고, 텍스트 매크로 목록 `translation/text-macros.txt`로 대명사 위젯의 생략·재배치를 허용한다. 묶음 3~4개마다 빌드·검증·커밋.

**Tech Stack:** Python 3.10 표준 라이브러리, `unittest`, tweego(번들), Node 22(`node --check`), Claude Code 서브에이전트.

**Spec:** `docs/specs/2026-11-12-translation-stage2-design.md`

## Global Constraints

- 작업은 `main`에서 묶음 단위 커밋(작업 브랜치 없음). 커밋 전 검증: `check_translation.py` 전부 ok, `./build.sh` 성공, `verify_build.py <영문> "dist/DoL-KR 0.5.13.8.html" --names-only` OK, `python3 -m unittest discover -s tools/test -t .` 통과, `check_kr_symbols.py check` OK, STATUS 갱신.
- 번역 커밋은 코드 동작을 바꾸지 않는다: 매크로 이름·인자 구조, `$변수`·`_변수`, `[[링크|대상]]`의 대상, 값으로 쓰이는 문자열(`<<set $x to "m">>`, `either("m","f")`, CSS 클래스, 패시지 이름) 보존.
- 허용 조사 마커: 【은는】【이가】【을를】【와과】【으로로】【아야】【이나나】【이】【이었였】. 검사는 바뀐 줄에만.
- 텍스트 매크로(생략·재배치 허용)는 `translation/text-macros.txt`에 있는 이름뿐. 그 밖의 매크로는 순서까지 보존.
- JS: 문자열 리터럴 내용과 주석을 제외한 코드가 바이트 동일. 예외: 허용 속성(`counter`)의 `이름: "…",` 줄 추가. CSS 변경 금지. 의상 `name:`은 번역하지 않고 `kr_dict.js` 사전으로만.
- 기존 번역(영문이 손대지 않은 줄)은 고치지 않는다. 에이전트는 커밋하지 않는다. 동시 에이전트 최대 3개, 서로 다른 파일.
- 에이전트 묶음 크기: `new_en` 산문 줄 약 300~500줄. 큰 파일은 단독 묶음.
- Python은 표준 라이브러리만. 커밋 꼬리말 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. 번역 커밋 메시지는 `i18n: <요약> (<n>건)`.
- 참고 경로: 영문 비교 빌드 `/home/chan/game/baseline/en-0.5.13.8.html`.

## Review Focus

1. **에이전트가 `<<link "다음">>`의 라벨은 바꾸고 `[[다음|Forest Cabin]]`의 대상은 보존해야 한다.** 라벨 변경은 통과, 대상 변경은 실패. → Task 1 `test_link_label_may_change_target_may_not`.
2. **`<<He>>`를 문장에서 빼거나 `<<he>>`로 바꾸는 것은 통과, `<<else>>`·`<<endevent>>`를 빼면 실패.** → Task 1 `test_text_macro_dropped_ok_structural_macro_dropped_fails`.
3. **바뀌지 않은 줄에 이미 있는 비허용 마커(【의】)는 통과, 바뀐 줄에 새로 쓴 비허용 마커는 실패.** → Task 1 `test_josa_checked_on_changed_lines_only`.
4. **JS에서 `counter: "송이",` 추가는 통과, 다른 속성 추가나 코드 변경은 실패.** → Task 1 `test_js_allows_counter_property_only`.
5. **역따옴표 템플릿 안 문자열(`<<= $x ? \`"젠장"\` : ...>>`)을 번역해도 통과, 그 안의 `<<he>>`·`$x`가 사라지면 실패.** → Task 1 `test_backtick_template_strings_are_prose`.

---

### Task 1: 구조 검사기 `tools/check_translation.py`

**Files:**
- Create: `tools/check_translation.py`
- Test: `tools/test/test_check_translation.py`

**Interfaces:**
- Produces:
  - `ALLOWED_JOSA = ("은는", "이가", "을를", "와과", "으로로", "아야", "이나나", "이", "이었였")`
  - `load_text_macros(path: str) -> set[str]` — 한 줄에 이름 하나, `#` 주석·빈 줄 무시, 소문자화.
  - `skeleton_twee(text: str, text_macros: set[str]) -> list[str]` — 토큰 열. 규칙: `<<...>>`는 이름이 `text_macros`(소문자 비교)에 있고 인자가 없으면 버린다; 그 외 매크로는 따옴표 문자열 내용을 비우고(`""`, `''`), 역따옴표 템플릿은 안의 `<<...>>`·`$id`·`_id`만 남긴 채 글자를 비운 토큰으로 남긴다(공백은 하나로 정규화). `[[a|b]]`·`[[a->b]]`·`[[b]]`는 `[[b]]`. HTML 태그 `<name attr="v" ...>`는 `<name attr>`(속성값 제거, `</name>` 유지). 매크로·링크·태그 밖의 `$id`·`_id`는 토큰으로 남긴다. 나머지 글자는 버린다. 줄 번호는 토큰에 붙이지 않는다.
  - `skeleton_js(text: str, allowed_props: tuple[str, ...] = ("counter",)) -> str` — `"…"`·`'…'`·`` `…` `` 내용 비움(이스케이프 처리), `//`·`/* */` 주석 제거, `^\s*(counter): "",?\s*$` 꼴 줄 제거, 줄 끝 공백 제거.
  - `josa_violations(before: str, after: str) -> list[tuple[int, str]]` — `after`에만 있는 줄(difflib로 `before`와 비교, `insert`/`replace`의 after 쪽) 안의 `【…】` 중 `ALLOWED_JOSA`에 없는 것. `(줄번호, 마커)`.
  - `prose_lines(text: str) -> int` — `translation_status.has_prose([line])`가 참인 줄 수.
  - `@dataclass Result(path, ok: bool, reason: str, line: int | None, remaining_prose: int)`
  - `check_file(rel: str, base_text: str, new_text: str, text_macros: set[str]) -> Result` — 확장자별: `.twee` → 스켈레톤 열 비교(첫 불일치 토큰의 인덱스로 `reason`에 앞뒤 토큰 3개씩), `.js` → `skeleton_js` 동일 비교, `.css` → 바이트 동일. 조사 위반이 있으면 `ok=False, reason="josa: 【의】"`. `remaining_prose`는 `new_text`의 영어 산문 줄 수.
  - CLI: `check_translation.py FILE... [--text-macros translation/text-macros.txt] [--base-ref HEAD]` — `git show <ref>:<file>`로 before를 얻는다(없으면 새 파일: 스켈레톤 비교 생략, 조사·산문만). `.js`는 `node --check`도 돈다. 파일마다 `ok <path> (english lines left: N)` 또는 `FAIL <path>: <reason>`. 종료 0/1.

- [x] **Step 1: 실패하는 테스트 작성**

```python
TM = {"he", "his", "him", "person1", "girl"}

class SkeletonTweeTests(unittest.TestCase):
    def test_prose_is_dropped_and_structure_kept(self):
        a = ct.skeleton_twee('<<if $x is 1>>Hello <<he>> there<<else>>Bye<</if>>', TM)
        b = ct.skeleton_twee('<<if $x is 1>>안녕 <<he>>【은는】 거기<<else>>잘 가<</if>>', TM)
        self.assertEqual(a, b)
        self.assertEqual(a, ['<<if $x is 1>>', '<<else>>', '<</if>>'])

    def test_link_label_may_change_target_may_not(self):
        base = '<<link [[Next|Forest Cabin]]>><<endevent>><</link>>'
        self.assertEqual(ct.skeleton_twee(base, TM), ct.skeleton_twee('<<link [[다음|Forest Cabin]]>><<endevent>><</link>>', TM))
        self.assertNotEqual(ct.skeleton_twee(base, TM), ct.skeleton_twee('<<link [[다음|Forest Cabin2]]>><<endevent>><</link>>', TM))
        self.assertEqual(ct.skeleton_twee('[[Next->Shop]]', TM), ct.skeleton_twee('[[다음->Shop]]', TM))

    def test_text_macro_dropped_ok_structural_macro_dropped_fails(self):
        base = '<<He>> smiles. <<he>> waves.<<endevent>>'
        self.assertEqual(ct.skeleton_twee(base, TM), ct.skeleton_twee('<<he>>【이가】 웃으며 손을 흔든다.<<endevent>>', TM))
        self.assertNotEqual(ct.skeleton_twee(base, TM), ct.skeleton_twee('<<he>>【이가】 웃으며 손을 흔든다.', TM))
        self.assertNotEqual(ct.skeleton_twee('<<if $a>>x<<else>>y<</if>>', TM), ct.skeleton_twee('<<if $a>>x<</if>>', TM))

    def test_macro_string_args_are_prose(self):
        self.assertEqual(ct.skeleton_twee('<<link "Next" "Shop">>', TM), ct.skeleton_twee('<<link "다음" "Shop">>', TM))
        self.assertEqual(ct.skeleton_twee('<<set $x to "m">>', TM), ct.skeleton_twee('<<set $x to "남">>', TM))  # 알려진 한계: 값 변경은 못 잡는다

    def test_backtick_template_strings_are_prose(self):
        base = '<<= $r gte 1 ? `"Fuck...!" <<he>> hisses` : `<<He>> curses`>>'
        self.assertEqual(ct.skeleton_twee(base, TM), ct.skeleton_twee('<<= $r gte 1 ? `"젠장...!" <<he>>【이가】 쉭 소리를 낸다` : `<<He>>【이가】 욕한다`>>', TM))
        self.assertNotEqual(ct.skeleton_twee(base, TM), ct.skeleton_twee('<<= $r gte 1 ? `"젠장...!"` : `욕한다`>>', TM))

    def test_html_tags_keep_name_and_attr_names(self):
        self.assertEqual(ct.skeleton_twee('<span class="gold">Money:</span>', TM), ct.skeleton_twee('<span class="gold">돈:</span>', TM))
        self.assertNotEqual(ct.skeleton_twee('<span class="gold">x</span>', TM), ct.skeleton_twee('<span class="red">x</span>', TM))

    def test_variables_in_prose_are_kept(self):
        self.assertNotEqual(ct.skeleton_twee('You have $money coins', TM), ct.skeleton_twee('동전이 있다', TM))
        self.assertEqual(ct.skeleton_twee('You have $money coins', TM), ct.skeleton_twee('$money개의 동전이 있다', TM))

class SkeletonJsTests(unittest.TestCase):
    def test_strings_and_comments_blanked(self):
        self.assertEqual(ct.skeleton_js('x = "Hello"; // hi\n'), ct.skeleton_js('x = "안녕"; // 안녕\n'))
        self.assertEqual(ct.skeleton_js("y = 'a\\'b'; /* c */ z = `t ${v} u`;"), ct.skeleton_js("y = '가'; z = `티 ${v} 유`;"))
        self.assertNotEqual(ct.skeleton_js('x = 1;'), ct.skeleton_js('x = 2;'))

    def test_js_allows_counter_property_only(self):
        base = 'a: {\n\tname: "apple",\n\tprice: 1,\n},\n'
        self.assertEqual(ct.skeleton_js(base), ct.skeleton_js('a: {\n\tname: "사과",\n\tcounter: "개",\n\tprice: 1,\n},\n'))
        self.assertNotEqual(ct.skeleton_js(base), ct.skeleton_js('a: {\n\tname: "사과",\n\tunit: "개",\n\tprice: 1,\n},\n'))

class JosaTests(unittest.TestCase):
    def test_josa_checked_on_changed_lines_only(self):
        before = "옛 줄【의】 그대로\nHello there\n"
        after = "옛 줄【의】 그대로\n안녕【은는】 거기【에게】\n"
        self.assertEqual(ct.josa_violations(before, after), [(2, "【에게】")])
        self.assertEqual(ct.josa_violations(before, before), [])

class CheckFileTests(unittest.TestCase):
    def test_ok_and_fail_results(self):
        r = ct.check_file("a.twee", "<<if $a>>Hi<</if>>", "<<if $a>>안녕<</if>>", TM)
        self.assertTrue(r.ok); self.assertEqual(r.remaining_prose, 0)
        r = ct.check_file("a.twee", "<<if $a>>Hi there<</if>>", "<<if $a>>Hi there", TM)
        self.assertFalse(r.ok); self.assertIn("<</if>>", r.reason); self.assertEqual(r.remaining_prose, 1)
        r = ct.check_file("s.css", "a{}", "a{ }", TM)
        self.assertFalse(r.ok)

class CliTests(unittest.TestCase):
    def test_cli_against_git_head(self):  # 임시 git 저장소: 커밋된 a.twee를 번역해 ok, 구조를 깨면 FAIL과 종료 1, 새 파일(HEAD에 없음)은 산문만 보고
        ...
```
`CliTests`는 `tempfile` 안에서 `git init`, 파일 커밋, 수정 후 `subprocess`로 CLI 실행(`cwd`=임시 저장소, `--text-macros`는 임시 파일). 단언: 첫 실행 `returncode 0`·stdout에 `ok a.twee`; 구조 깨뜨린 뒤 `returncode 1`·`FAIL a.twee`; 새 파일 `b.twee`는 `ok b.twee (english lines left: 1)`.

- [x] **Step 2: 실패 확인** — Run: `python3 -m unittest tools.test.test_check_translation 2>&1 | tail -3`. Expected: ERROR `No module named 'tools.check_translation'`.

- [x] **Step 3: 구현.** 토큰화는 한 번의 스캔으로: 위치별로 `<<`(매크로, 중첩 `<<`·`>>`는 역따옴표 안에서만 허용), `[[`, `<`(태그), `$`/`_`+식별자, 그 외 글자. 역따옴표 안에서는 매크로와 변수만 뽑고 그 밖은 비운다.

- [x] **Step 4: 통과 확인** — Expected: 13 tests OK. 이어서 `python3 tools/check_translation.py game/base-combat/man-combat.twee --text-macros /dev/null` → `ok …`(변경 없음이므로 통과해야 한다). 실제 큰 파일 하나로 속도 확인: 1초 이내.

- [x] **Step 5: 커밋** — `git add tools/check_translation.py tools/test/test_check_translation.py && git commit -m "feat(tools): check_translation 번역 전후 구조 스켈레톤 비교"`

---

### Task 2: 텍스트 매크로 목록 `translation/text-macros.txt`

**Files:**
- Create: `tools/text_macros.py`, `translation/text-macros.txt`
- Test: `tools/test/test_text_macros.py`

**Interfaces:**
- Consumes: `translation/pending/**/*.twee.json`, `translation_status.has_prose`.
- Produces: `candidates(root: str, min_records: int = 2) -> list[tuple[str, int, int]]` — `(이름 소문자, 횟수가 다른 기록 수, 등장 기록 수)`; 충돌 기록 중 `old_kr`이 있고 `old_en`에 산문이 있는 것만; 인자 없는 매크로 `<<name>>`만 센다. `DENY = {"else", "default", "break", "continue", "endevent", "exitall", "runeventpool", "cleareventpool", "stateman", "actionsman", "nexttext", "silently", "nobr"}` 제외. CLI `text_macros.py --root . [--min-records 2] --out translation/text-macros.txt` — 머리 주석(`# generated by tools/text_macros.py; name  differing/seen`) 뒤 이름만 한 줄씩. 파일 형식은 Task 1 `load_text_macros`가 읽는다.

- [x] **Step 1: 실패하는 테스트** — 임시 트리에 pending JSON 두 개를 두고: 한 기록은 `old_en`에 `<<He>>`·`<<he>>` 둘, `old_kr`에 `<<he>>` 하나(→ `he` 후보); `<<else>>`가 한쪽에만 있는 기록(→ DENY라 제외); 횟수가 같은 `<<person1>>`(→ 제외). `candidates(root, min_records=1)` == `[("he", 1, 1)]`. CLI가 `--out` 파일을 쓰고 `load_text_macros`로 읽으면 `{"he"}`.

- [x] **Step 2: 실패 확인** — Expected: 모듈 없음 ERROR.

- [x] **Step 3: 구현.**

- [x] **Step 4: 통과 확인, 실제 생성**

```bash
python3 -m unittest tools.test.test_text_macros && python3 tools/text_macros.py --root . --out translation/text-macros.txt && cat translation/text-macros.txt
```
Expected: `he`, `his`, `him`, `pshes`, `himself`, `pher`, `girl`, `laughs`, `bhis`, `hes`, `pshe`, `bastard`, `bitch`, `bhe`, `bottomsimple`, `bhim`, `person1`, `person`, `pussy`, `cunt`, `gpain`, `bottom`, `slut`, `npcpenissimple`, `person2` 안팎(2026-11-12 측정). 목록을 읽어 동작을 바꾸는 이름이 있으면 `DENY`에 넣고 다시 생성한다(`gpain`은 통증 문구 출력 위젯이므로 둔다).

- [x] **Step 5: 커밋** — `git add tools/text_macros.py tools/test/test_text_macros.py translation/text-macros.txt && git commit -m "feat(tools): 텍스트 매크로 목록 생성기와 목록"`

---

### Task 3: 묶음 생성기 `tools/translation_batches.py`, 지침서, 작업 로그

**Files:**
- Create: `tools/translation_batches.py`, `translation/TRANSLATOR.md`, `translation/LOG.md`
- Test: `tools/test/test_translation_batches.py`

**Interfaces:**
- Consumes: `translation/pending`, `translation_status.has_prose`, `is_done`.
- Produces:
  - `file_work(root: str) -> dict[str, dict]` — 파일별 `{"pass": 1|2|3, "lines": 산문 줄 수, "records": n}`. pass 1 = `conflict`이고 `old_kr` 비어 있지 않고 `has_prose(new_en)`이고 `not is_done`; pass 2 = `merged-new-text`이고 산문이고 미완료; pass 3 = `new-file`. 한 파일이 1과 2 모두면 pass 1로 두고 `lines`는 합산(에이전트가 그 파일의 영어를 모두 번역하므로). `lines`는 pass 3이면 파일의 `prose_lines`(Task 1).
  - `DIR_ORDER = ("base-system", "base-combat", "overworld-town", "overworld-plains", "overworld-forest", "overworld-underground", "04-Variables", "special-dance", "special-fishing", "special-masturbation", "base-clothing", "03-JavaScript")` 그 밖은 뒤에 이름순. pass 3의 순서는 설계 3.5(`loc-bus/thug.twee` → `loc-mines/*` → `speech/reaction-*`,`named-npcs-speech` → JS → `sky-testing`).
  - `make_batches(work: dict, max_lines: int = 450) -> list[dict]` — `{"id": "P1-01", "pass": 1, "files": [...], "lines": n}`. 같은 pass 안에서 디렉터리 순, 디렉터리 안에서 줄 수 내림차순; 누적 줄 수가 `max_lines`를 넘으면 새 묶음; 단독으로 `max_lines`를 넘는 파일은 혼자 한 묶음. 디렉터리가 바뀌어도 묶음을 끊지 않는다(작은 디렉터리들이 합쳐지도록).
  - `render_log(batches: list[dict]) -> str` — 표 `| 묶음 | 단계 | 파일 | 산문 줄 | 상태 | 메모 |`, 상태 초기값 `대기`.
  - CLI: `translation_batches.py --root . [--max-lines 450] [--pass N]` → 표를 stdout.

- [x] **Step 1: 실패하는 테스트** — 임시 트리에 pending JSON: `game/base-combat/a.twee`(conflict, old_kr 있음, 산문 10줄), `game/base-system/b.twee`(conflict 3줄 + merged-new-text 2줄 → pass 1, lines 5), `game/overworld-town/c.twee`(merged-new-text만 → pass 2), `game/overworld-town/loc-bus/thug.twee`(new-file; 실제 파일에 영어 2줄). 단언: `file_work` 결과의 pass·lines; `make_batches(work, max_lines=12)` → P1-01 = [b.twee(5)] + a.twee(10)? 아니오: 순서는 base-system 먼저이므로 P1-01=[b.twee, a.twee] 누적 15>12 → P1-01=[b.twee], P1-02=[a.twee]; P2-01=[c.twee]; P3-01=[thug.twee]. `render_log`에 `| P1-01 | 1 | game/base-system/b.twee | 5 | 대기 |  |`.

- [x] **Step 2: 실패 확인** — Expected: 모듈 없음.

- [x] **Step 3: 구현.**

- [x] **Step 4: 통과 확인, 실제 목록 생성** — `python3 tools/translation_batches.py --root . > /tmp/claude-1000/batches.md && head -20 /tmp/claude-1000/batches.md && grep -c '^| P' /tmp/claude-1000/batches.md`. Expected: 1차 약 45~60개, 2차 약 10~15개, 3차 약 8~12개.

- [x] **Step 5: `translation/TRANSLATOR.md` 작성** — 설계 3.2의 항목 전부. 구성: (1) 임무 한 문단(지정 파일의 영어 산문만 한글로; 다른 파일 금지; 커밋 금지), (2) 절대 바꾸지 않는 것(Global Constraints 두 번째 항목을 예시와 함께), (3) 옛 번역 활용법(`translation/pending/<경로>.json`의 `old_kr`/`old_en`/`new_en`; 영문이 조금 바뀐 자리는 옛 번역을 손보고, 구조가 바뀐 자리는 옛 번역을 용어·말투 참고로만), (4) 말투·표기(이인칭 "당신", NPC 이름은 `game/base-system/named-npcs.twee`·`game/kr_js/kr_dict.js`의 표기, 같은 파일에 살아 있는 한글 줄의 어조), (5) 조사 마커 목록과 쓰는 법(받침에 따라 자동 해소, 영어 단어·매크로 뒤에는 반드시 마커: `<<he>>【이가】`), (6) 번역하는 문자열과 아닌 문자열 구분(예시 표), (7) JS 파일 규칙(사용자에게 보이는 문자열만, `counter:` 추가 허용, 의상 `name:` 금지), (8) 끝낼 때 `python3 tools/check_translation.py <파일들>`을 돌려 전부 `ok`일 것, 실패하면 고칠 것, (9) 보고 형식(파일별 남은 영어 줄 수와 남긴 이유, 애매했던 용어).

- [x] **Step 6: `translation/LOG.md` 작성** — 머리: 설계 링크, 상태 값 설명(`대기`/`진행`/`완료`/`되돌림`/`건너뜀`), "기존 비허용 조사 마커" 절(설계 3.3의 약 35곳 목록: `grep -rnoE '【[^】]*】' game | grep -v -E '【(은는|이가|을를|와과|으로로|아야|이나나|이|이었였)】'` 결과를 붙인다), 그 아래 Step 4의 묶음 표.

- [x] **Step 7: 커밋** — `git add tools/translation_batches.py tools/test/test_translation_batches.py translation/TRANSLATOR.md translation/LOG.md && git commit -m "feat(tools): 번역 묶음 생성기, 번역 지침서, 작업 로그"`

---

### Task 4: 시험 묶음(P1-01)으로 절차 검증

**Files:**
- Modify: P1-01의 파일들(base-system), `translation/LOG.md`, `translation/STATUS.md`, `translation/TRANSLATOR.md`(다듬기)

**Interfaces:**
- Consumes: Task 1~3 전부.

- [x] **Step 1: 에이전트 프롬프트 작성** — 고정 부분을 `.superpowers/sdd/<이 계획>/agent-prompt.md`(작업 공간, 커밋 안 함)에 둔다. 내용: `translation/TRANSLATOR.md`를 먼저 읽을 것, 담당 파일 목록과 pending JSON 경로, 참고 경로, 끝낼 때 검사 명령, 보고 형식. 모델은 가장 강한 것으로 명시.

- [x] **Step 2: 에이전트 실행(P1-01)** — Expected: 보고에 파일별 `ok`와 남은 영어 줄 수.

- [x] **Step 3: 조율자 검사**

```bash
python3 tools/check_translation.py <P1-01 파일들> && python3 tools/check_kr_symbols.py check --root . --snapshot translation/kr-symbols.json && git diff --stat
```
Expected: 전부 ok. 실패 시 같은 에이전트에게 실패 출력을 보내 고치게 한다(최대 2회), 그래도 실패하면 `git checkout -- <파일>`하고 LOG에 `되돌림`.

- [x] **Step 4: 빌드·검증**

```bash
./build.sh && python3 tools/verify_build.py /home/chan/game/baseline/en-0.5.13.8.html "dist/DoL-KR 0.5.13.8.html" --names-only --show 0 | head -1 && python3 -m unittest discover -s tools/test -t . 2>&1 | tail -1 && python3 tools/translation_status.py --root . --tag 0.5.13.8 --out translation/STATUS.md
```
Expected: 빌드 성공, `only_a=0 only_b=0`, 테스트 OK, STATUS의 1차 완료 수 증가.

- [x] **Step 5: 번역 품질 표본 확인(조율자)** — `git diff` 중 한글 줄 20개를 읽어 말투·마커·이름 표기가 기존과 맞는지 본다. 어긋난 패턴이 있으면 `TRANSLATOR.md`에 규칙을 추가한다(이 단계에서만 지침서를 고친다; 이후 묶음은 같은 지침으로).

- [x] **Step 6: LOG 갱신과 커밋** — LOG의 P1-01 행을 `완료`로, 메모에 남은 영어 줄 수와 에이전트가 남긴 메모. `git add -A game translation && git commit -m "i18n: base-system P1-01 (<n>건)"`.

---

### Task 5: 1차(옛 번역 복원) 전체

**Files:** 1차 묶음의 파일들, `translation/LOG.md`, `translation/STATUS.md`

- [x] **Step 1: 반복** — P1-02부터 마지막까지 Task 4의 Step 2~3을 묶음마다, Step 4·6을 묶음 3~4개마다(또는 단독 묶음인 큰 파일마다) 반복한다. 동시 에이전트 최대 3개(서로 다른 묶음). 큰 대사 파일(`speech-avery`, `speech-sydney`, `ejaculation`, `man-combat`)은 한 묶음이 한 에이전트이고, 1,000줄이 넘으면 에이전트에게 패시지 경계로 절반씩 두 번에 걸쳐 하라고 지시한다. 각 커밋은 `i18n: <디렉터리> P1-xx..P1-yy (<n>건)`.
- [x] **Step 2: 되돌림·건너뜀 처리** — 되돌린 파일은 LOG에 이유와 함께 남기고, 1차가 끝난 뒤 한 번 더 시도한다(새 에이전트, 실패 출력 첨부).
- [x] **Step 3: 1차 완료 보고** — STATUS 합계, 남은 영어 줄 수 합계(LOG), 되돌림 목록을 사용자에게 보고하고 플레이 확인을 요청한다. 피드백으로 고친 것은 `i18n(fix): …` 커밋.

---

### Task 6: 2차(새 영문 371건)

- [x] Task 5와 같은 절차를 P2 묶음에 적용. 의상 JS는 `name:` 대신 `game/kr_js/kr_dict.js`에 항목 추가(에이전트 프롬프트에 명시; `kr_dict.js`는 검사기에서 JS 규칙으로 검사되므로 사전 객체에 `"English": "한글",` 줄 추가는 문자열 비우기 후 코드가 달라져 실패한다 → 이 파일만 `--base-ref`를 쓰지 않고 `node --check`와 눈 검사로 대신한다. 커밋 전 `node --check game/kr_js/kr_dict.js`). 완료 보고와 플레이 확인.

---

### Task 7: 3차(새 파일 27개)

- [x] Task 5와 같은 절차를 P3 묶음에 적용. 새 파일은 HEAD에 영어판이 있으므로 검사기 규칙이 그대로 적용된다. `modules/css/skin-tone-slider.css`는 대상 제외. `sky-testing.twee`는 마지막. 완료 보고와 플레이 확인.

---

### Task 8: 마무리

- [x] **Step 1:** STATUS 재생성, LOG 정리(되돌림·건너뜀·남은 영어 줄 수 최종표), README "0.5.13.8 추종 상태" 절을 "번역 2단계 완료(남은 항목: …)"로 갱신, `docs/plans/`의 이 계획에 완료 표시.
- [x] **Step 2:** `python3 -m unittest discover -s tools/test -t .`, `(cd server && npm test)`, `./build.sh`, 이름 집합 검증. 커밋 `docs: 번역 2단계 완료 상태`. `git push origin main`.
