# DoL 원격 세이브 설계

작성일: 2026-10-22

## 의도

Degrees of Lewdity(DoL) 0.5.12.13을 여러 기기(집 PC, 폰 등)에서 같은 세이브로 이어 하기 위해,
브라우저 IndexedDB에 저장되던 세이브를 홈 서버에 저장하도록 바꾼다.
게임은 홈 서버가 서빙하고, 모든 기기는 Tailscale로 그 서버에 접속한다.

## 목표

- 게임 안의 세이브 메뉴(저장/불러오기/삭제/전체 삭제/페이지 넘김/확인 창)가 지금과 똑같이 보이고 동작한다.
- 모든 슬롯(자동 저장 슬롯 0 포함)이 서버에 저장된다. 브라우저 로컬 저장은 쓰지 않는다.
- 다른 기기에서 저장한 세이브가 세이브 목록을 열면 바로 보인다.
- 대상은 한글판(`Degrees of Lewdity_kr.html`) 하나다. 영문판은 패치하지 않는다(사용자 결정). 단 저장소 층 코드가 영문판과 동일하므로 `patch.py`는 파일 경로를 인자로 받아 영문판에도 쓸 수 있게 만든다.
- 서버는 Docker Compose 한 번으로 뜬다. 세이브는 호스트 폴더에 파일로 남아 NAS 백업이 쉽다.
- 원본 HTML은 수정하지 않는다. 패치 결과물은 별도 파일로 만든다.

## 비목표

- 자동 동기화/충돌 해결. 같은 슬롯에 두 기기가 동시에 저장하면 나중 것이 이긴다.
- 기존 브라우저 세이브의 자동 이전. 사용자가 게임 안의 내보내기/가져오기로 직접 옮긴다.
- 철인 모드(ironman) 세이브. DoL이 IndexedDB를 쓰지 않는 별도 경로(SugarCube 로컬 세이브)라 이번엔 로컬에 남는다.
- 다중 사용자, 계정 시스템. 사용자는 한 명이다.
- 영문판 지원. 서버에는 세이브 슬롯 묶음이 하나뿐이며 게임 종류로 나누지 않는다.
- 오프라인 플레이. 서버에 못 붙으면 저장/불러오기는 실패하고 기존 idb 모듈의 오류 표시 경로(`log` → `Errors.report`/`alert`)로 알린다.

## 반목표 (이러면 실패)

- 게임 진행 중 저장 버튼을 눌렀는데 조용히 실패하고 세이브가 날아가는 것.
- 세이브 목록이 오래된 캐시를 보여줘서 다른 기기의 저장이 안 보이는 것.
- 서버 저장 중 전원이 나가서 세이브 파일이 반쯤 쓰인 채 깨지는 것.
- 원본 HTML을 덮어써서 되돌릴 수 없게 되는 것.

## 제약

- 게임은 소스가 아니라 빌드된 HTML(약 53MB / 58MB)만 있다. 패치는 HTML 텍스트 치환으로 한다.
- `img/` 폴더(약 78MB)를 HTML과 같은 상대 경로로 서빙해야 한다.
- 홈 서버: Ubuntu + Docker. 외부 접속은 Tailscale (사용자가 별도 설정).
- SugarCube v2.36.1. DoL의 idb 모듈은 `const idb=(()=>{ ... })();window.idb=idb;` 블록 하나다.

## 현재 코드 구조 (분석 결과)

DoL의 세이브는 `idb` 모듈이 담당한다. 이 모듈은 두 층으로 나뉜다.

1. **저장소 층** — IndexedDB를 직접 만지는 함수들. 모두 async.
   - `openDB(name, version)` — DB 열기. `_lock=false`로 풀고, 첫 생성 시 `importFromLocalStorage()` 호출.
   - `makePromise(transaction)` — IDB 요청을 Promise로.
   - `getItem(slot)` → `{slot, data: saveObj}` 또는 undefined
   - `setItem(slot, saveObj, details)` — `saves`와 `details` 두 스토어에 원자적으로 쓴다. 쓰기 전에 `funNuke`(함수 값 제거)와 delta 인코딩(`_settings.useDelta && slot !== 0`)을 적용한다. `_lock` 처리 포함.
   - `deleteItem(slot)` — 두 스토어에서 삭제 후 `getSaveDetails()` 재호출.
   - `getSaveDetails()` → `details` 스토어 전체 `[{slot, data:{date,id,idx,title,metadata}}]`. 결과를 `_saveDetails`에 캐시.
   - `getAllSaves()` → `saves` 스토어 전체 (업적 병합 화면에서만 사용).
   - `clearAll()` — 두 스토어 비움.
2. **UI/로직 층** — `saveState`, `loadState`, `saveList`, `generateSavesPage`, `generateSaveRow`, 설정(`updateSettings`, localStorage의 `idb-settings`). 저장소 층 함수를 클로저 내부에서 직접 호출한다.

중요한 사실:
- 저장소 층 함수들의 미니파이 텍스트는 영문판과 한글판에서 **바이트 단위로 동일**하다. UI 층만 한글 문자열이 다르다. 따라서 저장소 층만 치환하면 두 파일에 같은 패치가 먹힌다.
- `saveList()`는 모드 없이 호출될 때(목록 열 때)마다 `getSaveDetails()`를 다시 부른다. 그래서 저장소를 서버로 바꾸면 목록이 항상 서버 기준으로 최신이 된다.
- `loadState`는 `_saveDetails` 캐시에서 `idx`를 읽는다. 목록을 열어야 불러오기가 가능하므로 캐시는 항상 그 직전에 갱신된다. 단, SugarCube `Save.autosave.load()` → `idb.loadState(0)` 경로(자동 불러오기)는 목록을 거치지 않으므로 `loadState`가 캐시에 해당 슬롯이 없으면 `getSaveDetails()`를 먼저 호출하도록 해야 한다.
- `idb.init(Story.domId)`가 SugarCube 부팅 시 호출되어 `openDB`를 실행한다. `_lock`은 `openDB` 성공 시 풀린다. 서버 버전에서는 `init`이 서버 헬스체크(`GET /api/health`)를 한 뒤 성공/실패와 무관하게 `_lock=false`로 푼다(아래 "잠금과 요청 순서" 참고).
- 모듈 첫 줄 `if(null==window.indexedDB)return Object.freeze({lock:!0, ...})`는 IndexedDB 미지원 브라우저 대비. 서버 버전에서는 이 검사를 제거한다(IndexedDB가 필요 없으므로).
- `window.FCHostPersistent`(모바일 앱 래퍼)일 때 idb 기본 비활성. 무시해도 된다(브라우저에서만 쓴다).

## 결정 사항

### 구성 요소

```
dol-remote-save/
  docs/specs/2026-10-22-remote-save-design.md   (이 문서)
  patch/
    patch.py          원본 HTML → 패치된 HTML 생성 (python3, 표준 라이브러리만)
    remote-idb.js     치환해 넣을 저장소 층 코드 (사람이 읽을 수 있는 JS)
  server/
    Dockerfile
    docker-compose.yml
    package.json
    server.js         세이브 API + 정적 파일 서빙
  README.md           설치/실행/세이브 옮기기 순서
```

패치 결과물은 `dol-remote-save/dist/` 아래에 만든다. 기본 대상은 `../Degrees of Lewdity_kr.html` → `dist/Degrees of Lewdity_kr.html`. 다른 파일을 인자로 주면 그 파일을 같은 이름으로 `dist/`에 만든다.
서버는 호스트의 게임 폴더(원본 `img/`, `style.css` 등)와 `dist/`를 합쳐 서빙한다.

### 서버

- **런타임**: Node.js 22, Express. (제 결정. 정적 파일의 Range 요청과 큰 파일 서빙이 Express.static으로 바로 된다.)
- **포트**: 컨테이너 내부 8080. compose에서 호스트 포트도 기본 8080.
- **볼륨**:
  - `./saves` (호스트) → `/data` (컨테이너). 세이브 파일. 이 폴더를 NAS 백업 대상으로 삼는다.
  - 게임 폴더 → `/game` (읽기 전용). `img/`, `style.css`, 그리고 `dist/`의 패치된 HTML.
- **정적 서빙 규칙**: `/` 요청은 `/game/dist/` 를 먼저 보고, 없으면 `/game/` 을 본다. 그래서 `/Degrees of Lewdity_kr.html`은 패치본이 나가고 `/img/...`는 원본 폴더에서 나간다. `/` 루트는 `dist/`에 패치본이 하나면 그 파일로 리다이렉트하고, 여러 개면 링크 목록을 보여준다.
- **인증**: 환경변수 `SAVE_TOKEN`이 비어 있으면 인증 없음(기본값, Tailscale에 의존). 설정되어 있으면 모든 `/api/*` 요청에 `Authorization: Bearer <token>` 헤더를 요구한다. 클라이언트는 401을 받으면 `prompt()`로 토큰을 한 번 물어 `localStorage`의 `dol-remote-token`에 저장하고 재시도한다.
- **본문 크기 제한**: 64MB. DoL 세이브는 delta 인코딩 후 JSON으로 수 MB 단위다.
- **세이브 파일 형식**: 슬롯당 파일 하나 `/data/slot-<n>.json`, 내용은 `{"slot": n, "save": <saveObj>, "details": <detailsObj>}`. details는 목록 조회 때 매번 파일 전체를 읽지 않도록 별도 `/data/details.json`에 **같이** 유지한다. (제 결정: 슬롯 파일 하나에 두 데이터를 같이 두면 슬롯 단위 원자성이 저절로 생긴다. details.json은 목록용 인덱스이고, 불일치 시 슬롯 파일이 진실이다. 서버 시작 시 슬롯 파일들을 훑어 details.json을 재구성한다.)
- **원자적 쓰기**: 항상 `<파일>.tmp`에 쓰고 `fsync` 후 `rename`.
- **API** (모두 JSON):
  - `GET  /api/health` → `{ok:true}`
  - `GET  /api/saves/details` → `[{slot, data}]` (슬롯 오름차순)
  - `GET  /api/saves` → `[{slot, data: saveObj}]` 전체 (getAllSaves용)
  - `GET  /api/saves/:slot` → `{slot, data: saveObj}` / 없으면 404
  - `PUT  /api/saves/:slot` 본문 `{save, details}` → 슬롯 파일 쓰기 + details.json 갱신 → `{ok:true}`
  - `DELETE /api/saves/:slot` → `{ok:true}` (없어도 200)
  - `DELETE /api/saves` → 전체 삭제 → `{ok:true}`
  - slot은 0 이상 정수. 그 외 400.
- **로그**: 요청 한 줄씩 stdout. `docker compose logs`로 본다.

### 클라이언트 패치 (`remote-idb.js` + `patch.py`)

`patch.py`가 하는 일:
1. 원본 HTML을 읽어 `const idb=(()=>{`부터 `window.idb=idb;` 직전까지를 찾는다. 정확히 1개여야 하며, 아니면 실패한다.
2. 그 블록 안에서 아래 함수들의 미니파이 텍스트를 **정확한 문자열 일치**로 찾아 `remote-idb.js`의 대응 함수로 치환한다. 하나라도 못 찾으면 실패하고 어떤 함수인지 출력한다(버전이 바뀌면 바로 알 수 있도록).
   - 모듈 첫 줄의 `if(null==window.indexedDB)return ...;` 가드 → 제거
   - `function dbUpgrade`, `function openDB`, `function makePromise` → 제거 (대체 `openDB`는 `init`에서 헬스체크를 하고 `_lock=false`)
   - `async function importFromLocalStorage` → 빈 함수로 (호출부는 남아 있어도 무해)
   - `async function getItem`, `async function setItem`, `async function deleteItem`, `async function getSaveDetails`, `async function clearAll` → 서버 호출 버전
   - `getAllSaves` (모듈 끝 `Object.defineProperties` 안의 인라인 async 함수) → 서버 호출 버전
   - `async function loadState` → 캐시에 슬롯 details가 없으면 `getSaveDetails()`를 먼저 부르는 버전
   - `function updateSettings` → `active` 값을 항상 `true`로 고정하는 버전
   - 모듈 끝 `active:{get:()=>_active,set(val){_active=Boolean(val)}}` → 철인 모드일 때만 `false`를 허용하는 setter
   - `saves-idb-toggle` 버튼 생성 블록 → 제거
3. 결과를 `dist/<같은 파일명>`으로 쓴다. 원본은 건드리지 않는다.
4. `--check` 옵션: 치환 가능 여부만 검사하고 파일은 쓰지 않는다.

`remote-idb.js`의 저장소 함수 동작:
- 기본 URL은 현재 페이지의 origin (`location.origin`). 같은 서버에서 서빙되므로 CORS가 없다.
- `setItem`은 기존과 같은 전처리(`funNuke`, delta 인코딩, `_lock`)를 그대로 하고 `PUT`.
- 네트워크/HTTP 오류는 기존 `log(description, data)`로 보고한다. `setItem` 실패는 `false`를 반환한다. 기존 코드와 같은 계약.
- **잠금과 요청 순서** (검토 후 제 결정): 원본은 `_lock`이 걸려 있으면 `saveState`/`loadState`/`deleteItem`/`clearAll`이 조용히 아무것도 안 한다. IndexedDB는 순식간이라 괜찮았지만 네트워크에서는 자동 저장 업로드 중에 수동 저장을 누르면 세이브가 사라진다(반목표 1). 그래서:
  - 저장소 층 함수는 `_lock`을 건드리지 않는다. 대신 모듈 내부의 Promise 체인(뮤텍스)으로 요청을 **줄 세워** 순서대로 처리한다. 겹치는 호출은 버려지지 않고 기다린다.
  - `_lock`은 `init` 전까지만 `true`다. `init`은 `GET /api/health`를 호출하되, **성공/실패와 무관하게** `_lock=false`로 푼다. 실패하면 `log("세이브 서버에 연결할 수 없습니다", err)`로 한 번 알린다. 이후 저장/불러오기 시도는 각각 실패하면서 `log`로 보고된다. 조용히 잠기는 상태는 없다.
- `getSaveDetails`는 결과를 `_saveDetails`에 저장한다(기존과 같음).
- `localStorage`의 `idb-settings`(확인 창 켜기/끄기 등)는 기기별로 둔다. 세이브가 아니므로 동기화하지 않는다.

### 세이브 목록 화면

목록/확인 창/페이지 넘김은 변경 없음. 두 가지만 손댄다.
- 서버에서 쓴다는 걸 알 수 있게 `idb.footerHTML`에 "원격 저장: <서버 주소>" 한 줄을 추가한다. (제 결정. 작고 되돌리기 쉬움.)
- **로컬 저장소로 빠지는 구멍 제거** (검토 후 제 결정): 세이브 메뉴 하단의 "구형 저장소 사용" 버튼(`saves-idb-toggle`)과 설정 화면의 "IndexedDB 활성화" 체크박스(`checkbox-idbactive`)는 그 기기만 SugarCube 로컬 세이브로 빠지게 만든다. 사용자가 "로컬 저장은 안 한다"고 했으므로 패치에서 막는다. 방법: `updateSettings`와 `active` setter가 `active=false`를 무시하도록 바꾸고(항상 `true`), 세이브 메뉴의 `saves-idb-toggle` 버튼 생성 코드를 제거한다. 설정 화면 체크박스는 트위 패시지(HTML 이스케이프된 텍스트) 안에 있어 치환이 번거로우므로 그대로 두되, `active` setter가 무시하니 눌러도 효과가 없다. 단 `onLoad`가 철인 모드 세이브에서 `idb.active=false`를 거는 경로는 범위 밖(철인 모드)이므로 그대로 둔다. 이를 위해 setter는 "`V.ironmanmode`가 참일 때만 `false` 허용"으로 한다.

### 테스트

- `patch.py --check`가 한글판 원본에서 통과해야 한다.
- 클라이언트 저장소 층(`remote-idb.js`)은 브라우저 없이 Node에서 `fetch`를 목으로 바꿔 단위 테스트한다: 요청 직렬화(겹친 호출이 순서대로 나가는지), 실패 시 `log` 호출과 `false` 반환, `loadState`의 details 선조회.
- 서버: API 단위 테스트(Node 내장 `node:test`). PUT→GET→details→DELETE 흐름, 잘못된 슬롯 400, 원자적 쓰기(tmp 파일이 남지 않음), 시작 시 details.json 재구성.
- 통합 확인: 서버를 띄우고 패치된 HTML을 브라우저로 열어 저장 → 다른 브라우저 프로필(또는 시크릿 창)에서 목록 열기 → 보이는지 확인. 이건 수동.

## 빌더에게 맡기는 것

- Express 라우팅 세부, 에러 응답 본문 형식.
- 인덱스 페이지의 모양 (링크 목록이면 충분).
- `patch.py`의 치환 앵커를 어떻게 잡을지 (단, "정확한 문자열 일치, 못 찾으면 실패" 원칙은 지킨다).
- README의 세이브 옮기기 순서 설명 문구.

## 사용자가 할 일 (README에 적는다)

1. 홈 서버에 이 폴더(게임 폴더 전체)를 복사한다.
2. `python3 dol-remote-save/patch/patch.py` 실행 → `dist/Degrees of Lewdity_kr.html` 생성.
3. `cd dol-remote-save/server && docker compose up -d`.
4. Tailscale로 접속한 기기에서 `http://<서버이름>:8080/` 열기.
5. 기존 세이브는 옛 환경에서 "내보내기" → 새 주소에서 "가져오기" → 원하는 슬롯에 저장.
