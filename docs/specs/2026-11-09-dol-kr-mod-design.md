# DoL-KR-Mod 저장소 통합 설계

작성일: 2026-11-09. 대상 저장소: `Tareun34/DoL_KrTranslation` → `DoL-KR-Mod`로 개명.

## 1. 의도와 배경

지금까지 모드(원격 저장, Herm NPC)는 배포된 58MB HTML을 anchor 문자열로 찾아 고치는 파이썬 패치(`dol-remote-save/patch/herm.py`, `patch.py`)로 만들었다. 원문이 조금만 바뀌어도 깨지고, 읽기도 고치기도 어렵다.

한국어 번역 소스 전체(`DoL_KrTranslation`, 0.5.12.13)를 손에 넣었고, 이 소스는 번들된 tweego로 재현 빌드가 된다(2026-11-09 검증: 배포본과 passage 16,087개 이름 일치, 내용 차이는 번역 수정 20곳과 번역 헬퍼 JS 정리뿐). 번역 저장소의 원 관리자는 유지보수를 종료했다. 그래서 이 포크를 **단일 저장소**로 삼아 소스·모드·세이브 서버·빌드 스크립트를 모두 담고, 한 번의 빌드로 네 가지 HTML을 뽑는다.

## 2. 목표 / 비목표 / 금지

**목표**

- 저장소 하나(`DoL-KR-Mod`)에서 `./build.sh` 한 번으로 네 가지 HTML이 `dist/`에 생긴다: 원본, 원격 저장, Herm, Herm+원격 저장.
- Herm NPC 기능이 HTML 패치가 아니라 twee/JS 소스에 들어 있다. 동작은 기존 `herm.py` 규칙 15개와 동일하다.
- 원격 저장 기능이 빌드 입력(스토리 포맷)으로 들어 있다. 동작은 기존 `patch.py` + `remote-idb.js`와 동일하다.
- 세이브 서버가 이 저장소의 `server/`에서 그대로 돌고, 기존 세이브 데이터를 잃지 않는다.
- HTML 패치 스크립트(`herm.py`, `patch.py`, `build.sh`의 패치 체인)는 은퇴한다.

**비목표**

- 영문 0.5.13.x로 버전 올리기, 번역 추가, Android/APK 빌드, 세이브 서버 프로토콜 변경.
- 번역 소스 자체의 리팩터링. 모드에 필요한 최소 변경만 한다.

**금지(이렇게 되면 실패)**

- 원본 빌드가 모드 없는 번역판과 다르게 동작하는 것. Herm 코드는 들어 있어도 비율 기본값 0에서 원본과 동일해야 하고, 설정 화면에 Herm 항목이 보이면 안 된다.
- 기존 세이브(`server/saves/*.json`, `details.json`) 유실.
- 네 빌드 중 어느 하나라도 수동 단계가 필요한 것.

## 3. 핵심 사실(설계가 기대는 것)

- **tweego는 소스 경로를 여러 개 받는다**(`tweego [옵션] 소스...`). 폴더를 인자에 넣고 빼는 것으로 기능 포함 여부를 정할 수 있다.
- **원격 저장이 바꾸는 `idb` 모듈은 게임 소스가 아니라 스토리 포맷 안에 있다.** `devTools/tweego/storyFormats/sugarcube-2/format.js`는 `window.storyFormat({... "source": "<html>"})` 형태의 JSON 래퍼이고, 디코딩한 `source`에 `const idb=(()=>{ ... window.idb=idb;` 모듈과 `patch.py`의 anchor가 모두 정확히 한 번씩 존재한다(2026-11-09 확인). tweego는 `-f NAME`으로 스토리 포맷을 고른다.
- 현재 서버(`app.js`)는 루트(`/`)에서 `dist/`의 `*.html` 목록을 보여 주고, `dist/`와 게임 폴더(`img/`)를 정적으로 서빙한다. 네 파일을 `dist/`에 두기만 하면 선택 화면이 생긴다.
- Herm의 생성 로직은 비율이 0이면 원본과 동일한 분기를 탄다. 원본 빌드에서 가릴 것은 설정 UI(비율 슬라이더 2개, 네임드 NPC "양성" 라디오)뿐이다.

## 4. 결정한 것

### 4.1 저장소

- GitHub에서 `DoL_KrTranslation` → `DoL-KR-Mod`로 개명(사용자가 웹에서 수행). 로컬 폴더는 `/home/chan/game/DoL-KR-Mod`, 원격 `origin`은 새 URL. 번역 원 저장소를 알 수 있으면 `upstream`으로 추가한다(선택).
- 작업은 `main`에서 feature 브랜치로 진행하고 로컬 병합한다. 기존 `dol-remote-save`의 관례(설계 문서 `docs/specs/`, 계획 `docs/plans/`)를 따른다.

### 4.2 폴더 구조

```
DoL-KR-Mod/
  game/                      한국어 소스 (+ Herm 코드 in-tree)
  features/
    herm-ui/features.js      setup.features.herm = true  (Herm 빌드에만 포함)
  devTools/tweego/storyFormats/
    sugarcube-2/             원본 스토리 포맷 (그대로)
    sugarcube-2-remote/      원격 저장 스토리 포맷 (생성물, 커밋)
  tools/
    remote-idb.js            원격 저장 모듈 조각 (기존 patch/remote-idb.js)
    make-remote-format.py    sugarcube-2/format.js + remote-idb.js → sugarcube-2-remote/format.js
    verify-build.py          빌드 결과 대조 (6절)
    test/                    위 두 스크립트의 테스트
  server/                    세이브 서버 (기존 dol-remote-save/server 이동)
  build.sh                   네 변형 빌드
  dist/                      빌드 산출물 (git-ignore)
  docs/specs, docs/plans     설계·계획 (기존 문서도 이동)
  README.md                  저장소 안내 (번역 README 내용은 절 하나로 보존)
```

### 4.3 네 가지 빌드

| 변형 | 소스 인자 | 스토리 포맷 | 출력 파일명 |
|---|---|---|---|
| 원본 | `game/` | `sugarcube-2` | `DoL-KR <ver>.html` |
| 원격 저장 | `game/` | `sugarcube-2-remote` | `DoL-KR <ver> remote.html` |
| Herm | `game/ features/herm-ui/` | `sugarcube-2` | `DoL-KR <ver> herm.html` |
| 둘 다 | `game/ features/herm-ui/` | `sugarcube-2-remote` | `DoL-KR <ver> herm-remote.html` |

- `<ver>`는 `version` 파일 내용(현재 `0.5.12.13`). `FORCE_VERSION` 환경 변수로 덮어쓸 수 있다.
- `build.sh`는 기존 `compile.sh`의 tweego 바이너리 선택 로직을 재사용하고, `--head devTools/head.html --module modules`를 동일하게 넘긴다. 네 변형을 순서대로 빌드하고 하나라도 실패하면 0이 아닌 코드로 끝난다. `Degrees of Lewdity.html` 심볼릭 링크는 만들지 않는다(Android 빌드 비목표).
- `compile.sh`는 남겨 둔다(원본 단일 빌드용 참고). 삭제 여부는 빌더 재량.

### 4.4 Herm 소스 이식

- `herm.py`의 규칙 15개를 다음 소스 파일에 직접 반영한다. 규칙별 old/new 문자열은 `herm.py`의 `REPLACEMENTS`가 정본이다.
  - `game/base-combat/npc-generation.twee`, `beast-generation.twee` (생성 분기 4개)
  - `game/base-system/named-npcs.twee`, `persistent-npcs.twee` (gender 결정 2개)
  - `game/base-system/settings.twee` (슬라이더 UI, 네임드 "양성" 라디오)
  - `gameStartOnly` passage, `game/04-Variables/variables-versionUpdate.twee` (기본값)
  - `game/04-Variables/presets.twee` (`presetConfirm` case)
  - `game/03-JavaScript/save.js` 등 `settingsObjects` 정의 (female/male 항목, npc gender "h")
  - `Widgets NPCs` passage (생식기 반응 억제)
- **UI 노출만 스위치로 감싼다.** 슬라이더 2개는 `<<if setup.features?.herm>>`로 감싼다. 네임드 "양성" 라디오는 원본이 `$debug is 1`로 가리고 있었으므로 `$debug is 1 or setup.features?.herm`로 감싸 원본 동작을 보존한다. 나머지(생성 분기, 기본값, settingsObjects, preset case, 반응 억제)는 모든 빌드에 들어간다. 비율이 0이면 원본과 동일 동작이고, settingsObjects에 키가 있어도 내보내기/가져오기 값이 0일 뿐이다.
  - **정정(2026-11-09 리뷰)**: 이 전제는 불완전했다. settingsObjects 항목에 `randomize: "encounter"`가 있으면 원본 빌드의 "조우 무작위"가 비율을 뽑고, 가져오기/프리셋 미리보기도 값을 받아들인다. 그래서 Herm 빌드가 아니면 `randomize`를 끄고, `importSettingsData`에서 두 키를 버리고, `presetConfirm`에서 알 수 없는 설정으로 표시한다. `tools/test/test_herm_gating.py`가 이 게이팅을 고정한다.
- `features/herm-ui/features.js`는 `setup.features = Object.assign(setup.features || {}, { herm: true });` 한 줄이다. 로드 순서에 기대지 않도록 twee 쪽은 옵셔널 체이닝으로 읽는다.
- 반응 억제 조건은 기존 결정 유지: `$crossdressing is 2`이고 플레이어 외견 성별에 해당하는 Herm 비율이 20 이상이면 억제. 외견 불일치(`$crossdressing is 1`) 분기는 넣지 않는다.

### 4.5 원격 저장 스토리 포맷

- `tools/make-remote-format.py`는 기존 `patch.py`의 `patch_html`/`load_sections`를 그대로 가져와, 대상만 HTML → `format.js`의 디코딩된 `source`로 바꾼 것이다. 절차: `window.storyFormat(` 래퍼를 벗겨 JSON 파싱 → `source`에 `patch_html(source, fragment)` → JSON 직렬화(`ensure_ascii=False`, 원본과 같은 키 순서) → 래퍼 복원 → `sugarcube-2-remote/format.js`로 쓴다. 메타데이터의 `name`은 `"SugarCube"` 그대로 두되 tweego가 폴더명으로 포맷을 식별하므로 충돌하지 않는다. (빌더는 tweego가 `name`/`version` 중복을 거부하지 않는지 첫 빌드에서 확인한다.)
- 생성물은 **커밋한다**. 재생성은 `remote-idb.js`나 원본 `format.js`가 바뀔 때만 필요하고, `--check` 모드로 "커밋된 생성물이 현재 입력과 일치하는가"를 검사할 수 있어야 한다.
- `remote-idb.js`의 동작(서버 주소 `location.origin`, 토큰 입력, 원격 전용 강제, 푸터의 "원격 저장: host" 표기, 레거시 버튼 제거)은 변경하지 않는다.

### 4.6 서버와 배포

- `server/` 전체를 이동한다. **정적 서빙은 허용 목록 방식으로 바꾼다**(작성자 결정): 저장소 루트를 통째로 마운트하면 `server/saves/*.json`, `.env`의 토큰, `.git/`, 소스가 HTTP로 노출되므로, compose는 `../dist:/game/dist:ro`와 `../img:/game/img:ro` 두 경로만 마운트하고, `app.js`는 `DIST_DIR`(기본 `/game/dist`)과 `IMG_DIR`(기본 `/game/img`, URL `/img/`)만 서빙한다. 기존 `/dol-remote-save` 경로 차단 가드와 그 테스트는 제거하고, 허용 목록 테스트로 대체한다. 세이브 프로토콜(API)은 바뀌지 않는다.
- compose에 프로젝트 `name:`을 명시한다(새 폴더도 basename이 `server`라 기존 컨테이너와 이름이 충돌함). Dockerfile의 Node 버전은 빌더 재량.
- 세이브 데이터 이전: 기존 `dol-remote-save/server/saves/` 내용을 새 `server/saves/`로 복사한다(파일 소유자가 root이므로 `sudo` 또는 `docker cp`가 필요할 수 있음). 복사 → 새 컨테이너 기동 → 저장/불러오기 확인 → 옛 컨테이너 정지 순서를 지킨다. 포트 8080은 동시에 못 쓰므로 옛 컨테이너를 먼저 내리고 새 것을 올리되, 데이터 복사가 끝난 뒤에만 내린다.
- 서버 전환은 **빌더가 직접 수행한다**(사용자 결정). 세이브 파일 복사에 `sudo`나 `docker cp`가 필요하면 그때 사용자에게 요청하고, 옛 컨테이너를 내리기 직전에 한 번 확인을 받는다. 전환 후 저장·불러오기·목록 표시를 실제로 확인한다.
- 이전이 끝나면 `dol-remote-save`와 `DOL_0.5.12.13` 폴더 정리는 **사용자가** 한다. 빌더는 삭제하지 않는다.

### 4.7 문서

- `dol-remote-save/docs/specs/*`, `docs/plans/*`를 **파일로 복사**해 가져온다(사용자 결정). git 커밋 이력은 병합하지 않고, 기존 `dol-remote-save` 폴더를 보관용으로 남겨 참고한다. 이 문서도 `docs/specs/`에 둔다.
- 새 `README.md`: 저장소 목적, 네 가지 빌드, 서버 기동, 개발 명령(빌드·테스트·포맷 재생성), 크레딧(원작 Vrelnir, 번역 Tareun34 및 원 번역팀, CC-BY-NC-SA). 기존 번역 README의 안내문은 절 하나로 남긴다.

## 5. 제약

- 언어/도구: bash, Python 3(표준 라이브러리만), Node 24(서버). tweego는 저장소에 번들된 바이너리.
- 커밋 메시지는 기존 저장소 관례(한국어 또는 conventional commits)를 따르고 Co-Authored-By 꼬리말을 붙인다.
- 저장소에 58MB HTML을 커밋하지 않는다(`dist/`, 루트 `*.html` git-ignore).

## 6. 검증 기준

1. **포트 충실성**: `herm-remote` 빌드를 현 배포 체인(`herm.py` → `patch.py`를 2026-11-09 재현 빌드 HTML에 적용한 결과)과 passage 단위로 비교해, 차이가 "스위치 조건문 추가"와 공백뿐이어야 한다. `tools/verify-build.py`가 이 비교를 자동화한다(passage 집합 동일, 내용 차이 passage 목록과 첫 diff 출력).
2. **원본 무해성**: `원본` 빌드를 모드 없는 소스의 재현 빌드와 비교해, 차이가 Herm이 손댄 passage/JS에 국한되고, 설정 화면 passage에 Herm 항목이 렌더되지 않는지(`setup.features` 미정의 경로) 확인한다.
   - 1과 2는 **이번 이식의 일회성 검사**다(작성자 결정). 기준 HTML 두 개(모드 없는 재현 빌드, 거기에 옛 패치 체인을 적용한 결과)는 저장소 밖 경로로 인자에 넘기며 커밋하지 않는다. `verify-build.py`는 두 HTML을 받아 passage 단위 비교를 출력하는 범용 도구로 두고, 자체 테스트는 passage 추출 함수 수준이면 충분하다. 옛 `herm.py`/`patch.py`는 기준 파일을 만든 뒤 저장소에 넣지 않는다(`patch.py`의 로직은 `make-remote-format.py`가 흡수한다).
3. **스토리 포맷 생성 테스트**: `make-remote-format.py`에 기존 `test_patch.py`를 이식한 테스트(섹션 로딩, anchor 1회성, 이미 패치됨 거부, `--check`).
4. **서버 테스트**: 기존 `node --test` 통과.
5. **수동 확인**: 원격 변형을 Tailscale 주소로 열어 저장·불러오기·목록 표시, Herm 변형에서 설정 슬라이더 노출, 원본 변형에서 비노출.

## 7. 빌더에게 맡기는 것

- `tools/` 내부 파일명과 테스트 프레임워크(기존 `unittest`/`node --test` 유지 권장).
- `build.sh`의 로그 형식, 임시 파일 처리, 실패 시 메시지.
- `compile.sh` 삭제 여부.
- `features/herm-ui/`의 파일명과 `setup.features` 외 다른 전역을 쓸지 여부(단, 로드 순서 의존 금지).
- README의 상세 구성.
