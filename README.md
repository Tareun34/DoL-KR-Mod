# DoL-KR-Mod

[Degrees of Lewdity](https://vrelnir.blogspot.com/) 한국어 번역판 소스(번역은 0.5.12.13 기준)에 영문 0.5.13.8을 병합하고 두 가지 모드를 더한 저장소입니다.
한 번의 빌드로 네 가지 HTML을 만들고, 같은 저장소의 세이브 서버로 원격 저장을 운영합니다.

- **Herm NPC**: NPC가 자지와 보지를 모두 가질 수 있게 하는 설정 두 개를 추가합니다.
- **원격 저장**: 브라우저 대신 세이브 서버에 저장해서 어느 기기에서 열어도 같은 세이브를 씁니다.

## 네 가지 빌드

| 파일 | 내용 | 이런 분이 씁니다 |
|---|---|---|
| `DoL-KR 0.5.13.8.html` | 번역판 그대로 | 모드 없이 번역판만 |
| `DoL-KR 0.5.13.8 remote.html` | 원격 저장 | 서버에 세이브를 두고 여러 기기에서 |
| `DoL-KR 0.5.13.8 herm.html` | Herm NPC | 로컬 저장 + Herm 설정 |
| `DoL-KR 0.5.13.8 herm-remote.html` | 둘 다 | 서버 운영자의 기본 선택 |

원본 빌드에도 Herm 코드는 들어 있지만 설정 화면에 보이지 않고, 불러온 세이브에 Herm 비율이 있어도 0으로 되돌립니다.
`remote` 변형은 세이브 서버에서 열어야 동작합니다(파일을 직접 열면 저장이 실패합니다).

## 영문 0.5.13.8 추종 상태

2026-11-10에 영문 0.5.13.8(태그 `0.5.13.8`)을 파일 단위 3-way 병합으로 받아들였고(`docs/specs/2026-11-10-upstream-0.5.13.8-design.md`), 2026-11-12~16에 번역 2단계(`docs/specs/2026-11-12-translation-stage2-design.md`)를 마쳤습니다. 코드·이미지·구조는 영문 0.5.13.8과 같고, 영문이 손대지 않은 번역은 그대로이며, 영문이 고친 문장(2,547건)과 새 콘텐츠(새 영문 371건, 새 파일 27개: 광산 리워크·부랑배 이벤트·NPC 반응 대사 등)는 번역 에이전트가 옛 번역을 바탕으로 다시 넣었습니다.

- 번역 작업 기록은 [`translation/LOG.md`](translation/LOG.md)(묶음별 결과·용어 결정·코드 측 보정), 자리별 기록은 `translation/pending/`, 요약은 [`translation/STATUS.md`](translation/STATUS.md)에 있습니다. 완료 판정은 문자열 일치에 기대는 근사치입니다.
- 번역은 검수 없이 들어갔습니다. 플레이 중 어색한 문장이나 영어로 남은 자리를 발견하면 파일과 문장을 알려 주세요. 개발자 주석·패시지 이름·코드 값은 의도적으로 영어입니다.
- `dist/`에 남아 있는 `DoL-KR 0.5.12.13 *.html` 네 개는 **보관용**입니다. 영문이 이미지 19개의 경로를 바꿨고 `img/`는 하나뿐이라 옛 빌드는 홍조·스토킹 아이콘 등 일부 이미지가 깨집니다. 0.5.13.8에서 저장한 세이브는 0.5.12.13에서 열리지 않을 수 있습니다.
- 빌드 검증 기준: 원본 변형과 영문 0.5.13.8 빌드의 패시지 이름 집합이 같습니다(허용 목록 없음, 16,455개). Herm 변형과 원본 변형은 패시지 차이가 없고 스크립트 차이는 `features/herm-ui/features.js` 3줄뿐입니다. 원본과 원격 변형은 `idb` 모듈 교체분만 다릅니다.

## 빌드

```bash
./build.sh                         # dist/ 에 네 파일 생성 (버전은 version 파일)
FORCE_VERSION=test ./build.sh      # 파일명의 버전 문자열만 바꿀 때
```

tweego는 `devTools/tweego/`에 번들된 바이너리를 씁니다(Linux x64/x86, macOS Intel/Apple Silicon, Windows x64/x86). PATH에 `tweego`가 있으면 그것을 우선 씁니다. 네 변형은 `dist/.build/`에 먼저 만들어지고 전부 성공했을 때만 `dist/`로 한꺼번에 교체되므로, 하나라도 실패하면 0이 아닌 코드로 끝나고 기존 `dist/` 파일은 그대로 남습니다.

## 세이브 서버

```bash
cd server
docker compose up -d --build       # 8080 포트, 세이브는 server/saves/
docker compose logs -f
```

브라우저로 서버 주소(예: Tailscale 주소 `http://<host>:8080/`)를 열면 `dist/`의 HTML 목록이 뜹니다. 서버는 `dist/`의 HTML과 `img/`만 정적으로 내보내고, 세이브는 `/api/*`로만 다룹니다.

선택 설정은 `server/.env`에 둡니다.

```
HOST_PORT=8080        # 호스트에서 열 포트
SAVE_TOKEN=비밀번호    # 비워 두면 인증 없음 (Tailscale 등 네트워크에 맡김)
```

`SAVE_TOKEN`을 두면 게임이 처음 서버에 붙을 때 비밀번호를 한 번 묻고 브라우저에 기억합니다.

세이브는 `server/saves/slot-<번호>.json`(0번은 자동 저장)과 목록용 `details.json`입니다. **백업은 이 폴더를 잡으면 됩니다.** `details.json`은 서버가 시작할 때 다시 만들어집니다.

알아둘 것:

- 같은 슬롯에 두 기기가 동시에 저장하면 나중에 저장한 쪽이 남습니다.
- 철인 모드 세이브는 게임이 별도 경로로 저장하므로 그 기기의 브라우저에만 남습니다.
- 서버에 연결되지 않으면 저장/불러오기는 실패하고 게임 안에 오류가 표시됩니다. 오프라인 저장은 없습니다.
- 세이브 메뉴의 "구형 저장소 사용" 버튼은 원격 변형에서 제거했습니다.
- 옵션·설정을 바꾼 뒤 바로 저장하면 세이브에 안 들어갑니다(원본 엔진 동작). 다른 화면으로 한 번 이동한 뒤 저장하세요.

## Herm NPC 설정

- 설정 화면의 NPC 성별 항목에 "자지와 보지가 모두 있는 여성/남성의 비율" 슬라이더가 생깁니다.
- 새로 생성되는 랜덤 NPC, 짐승, 네임드 NPC, 지속 NPC에 적용됩니다. 기존 "자지가 있는 여성의 비율" 등이 먼저 적용되고, "둘 다"는 남는 범위 안에서만 적용됩니다. 두 값의 합이 100을 넘으면 "둘 다"가 잘립니다.
- "둘 다" 비율이 20 이상이면 양성 플레이어의 생식기를 본 NPC의 놀라는 반응이 사라집니다.
- 기존 세이브에서도 설정은 보이지만, 이미 성별이 정해진 NPC는 바뀌지 않고 새로 만나는 NPC부터 적용됩니다.
- 네임드 NPC 항목에서 생식기를 "양성"으로 직접 고를 수 있습니다(원본은 개발자 모드에서만 보이던 선택지). 설정 내보내기·가져오기도 이 값을 보존합니다.
- Herm 빌드가 아니면 두 비율은 가져오기·내보내기·"조우 무작위"에서 제외되고, 가져오기 미리보기에는 변수 이름 그대로 표시됩니다.
- Herm 세이브를 Herm이 아닌 빌드에서 열면, 이미 "양성"인 네임드 NPC에는 그 선택지가 그대로 보입니다. 다른 값으로 바꾸면 선택지는 사라집니다.

## 개발

```bash
python3 -m unittest discover -s tools/test -t .     # 빌드 비교 도구, 스토리 포맷 생성기
(cd tools/test && node --test)                       # 원격 저장 모듈(remote-idb.js)
(cd server && npm ci && npm test)                    # 세이브 서버
python3 tools/make_remote_format.py --check          # sugarcube-2-remote 가 최신인지
python3 tools/check_kr_symbols.py check --root . --snapshot translation/kr-symbols.json   # 한글판 전용 정의 유실 점검
python3 tools/translation_status.py --root . --tag 0.5.13.8 --out translation/STATUS.md  # 번역 상태 갱신
python3 tools/check_translation.py <파일들>              # 번역 전후 구조(매크로·변수·링크 대상) 동일성 검사
```

번역 작업 방식(에이전트 지침, 구조 검사기, 묶음 생성)은 `translation/TRANSLATOR.md`와 `docs/specs/2026-11-12-translation-stage2-design.md`에 있습니다.

다음 영문 버전을 병합할 때(예: 0.5.13.9):

1. 영문 저장소에서 해당 태그의 worktree를 만들고, 그 안에서 `FORCE_VERSION=<태그> ./compile.sh`로 비교용 HTML을 저장소 밖에 만들어 둡니다.
2. `python3 tools/check_kr_symbols.py snapshot --ours . --base <현재 기준 영문 트리> --out translation/kr-symbols.json` 으로 한글판 전용 정의를 다시 찍습니다.
3. `python3 tools/merge_upstream.py --base <현재 기준 영문 트리> --new <새 영문 트리> --ours .` 를 실행하고 결과를 단독 커밋으로 남깁니다. 기준 트리는 **직전에 병합한 영문 버전**입니다. 보고서의 `unrecorded_new_lines`가 0이 아니면 도구가 1로 끝나며 기록이 불완전한 것이니 먼저 원인을 봅니다. 기존 `translation/pending` 기록 중 아직 번역되지 않은 것은 보존되고 새 기록이 뒤에 붙습니다. 기록만 다시 만들고 싶으면 옛 소스를 임시 디렉터리에 꺼내 `--ours <임시> --skip-img`로 돌린 뒤 `translation/pending/`만 가져옵니다.
4. `check_kr_symbols.py check`가 0건이 될 때까지 밀려난 정의를 `translation/pending`의 `old_kr`에서 되살립니다.
5. Herm 규칙(`docs/specs/2026-10-30-herm-npcs-design.md`)을 다시 점검합니다. `tools/test/test_herm_gating.py`가 실패하면 빠진 규칙이 있는 것입니다.
6. `./build.sh` 후 `tools/verify_build.py <영문 HTML> "dist/DoL-KR <태그>.html" --names-only` 와 위의 Herm·원격 비교를 통과시킵니다.

구조:

- `game/` 번역 소스. Herm 규칙이 들어 있고, 설정 UI는 `setup.features?.herm`로 가립니다.
- `features/herm-ui/features.js` Herm 빌드에만 포함되는 스위치 한 줄.
- `devTools/tweego/storyFormats/sugarcube-2-remote/` 원격 저장용 스토리 포맷. `idb` 저장 모듈이 게임 소스가 아니라 SugarCube 번들 안에 있어서, `tools/make_remote_format.py`가 원본 포맷의 `source`에 `tools/remote-idb.js`를 입혀 만듭니다. `remote-idb.js`나 원본 `format.js`를 바꾸면 다시 생성해 커밋합니다.
- `tools/verify_build.py A.html B.html [--allow ...] [--max-script-diff N] [--names-only]` 두 빌드를 passage 단위로 비교합니다.
- `tools/merge_upstream.py` 영문 새 버전을 파일 단위 3-way로 병합하고 `translation/pending/`에 기록을 남깁니다. `tools/translation_status.py`가 그 기록으로 `translation/STATUS.md`를 만들고, `tools/check_kr_symbols.py`가 한글판 전용 정의의 유실을 잡습니다.
- `translation/` 번역 작업 목록(`pending/`, `STATUS.md`)과 한글판 전용 정의 스냅샷(`kr-symbols.json`).
- `server/` Express 세이브 서버와 Docker 설정.
- `docs/specs/`, `docs/plans/` 설계와 구현 계획. `docs/README-translation.md`는 번역판 원 저장소의 README 전문입니다.

## 한국어 번역판 안내

이 저장소는 [Tareun34/DoL_KrTranslation](https://github.com/Tareun34/DoL_KrTranslation)(아카라이브 DOL 채널 중심으로 진행된 번역, 0.5.12.13)을 포크한 것입니다. 원 번역 관리자는 저장소 공개 시점에 정기 유지보수를 종료했고, 이후 수정은 이 포크에서 이어집니다. 번역판의 안내문과 원작의 영문 README 전문은 [`docs/README-translation.md`](docs/README-translation.md)에 그대로 있습니다.

## 크레딧과 라이선스

- 원작: Vrelnir, [Degrees of Lewdity](https://vrelnir.blogspot.com/)
- 한국어 번역: 아카라이브 DOL 채널 번역팀, 저장소 공개 Tareun34
- 모드와 서버: 이 저장소

원작과 번역판에 적용된 **CC-BY-NC-SA** 라이선스를 그대로 따릅니다. 저작자 표시, 비영리, 동일 조건 변경 허락. 자세한 내용은 `LICENSE`를 참고하세요.
