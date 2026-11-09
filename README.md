# DoL-KR-Mod

[Degrees of Lewdity](https://vrelnir.blogspot.com/) 한국어 번역판(0.5.12.13) 소스에 두 가지 모드를 더한 저장소입니다.
한 번의 빌드로 네 가지 HTML을 만들고, 같은 저장소의 세이브 서버로 원격 저장을 운영합니다.

- **Herm NPC**: NPC가 자지와 보지를 모두 가질 수 있게 하는 설정 두 개를 추가합니다.
- **원격 저장**: 브라우저 대신 세이브 서버에 저장해서 어느 기기에서 열어도 같은 세이브를 씁니다.

## 네 가지 빌드

| 파일 | 내용 | 이런 분이 씁니다 |
|---|---|---|
| `DoL-KR 0.5.12.13.html` | 번역판 그대로 | 모드 없이 번역판만 |
| `DoL-KR 0.5.12.13 remote.html` | 원격 저장 | 서버에 세이브를 두고 여러 기기에서 |
| `DoL-KR 0.5.12.13 herm.html` | Herm NPC | 로컬 저장 + Herm 설정 |
| `DoL-KR 0.5.12.13 herm-remote.html` | 둘 다 | 서버 운영자의 기본 선택 |

원본 빌드에도 Herm 코드는 들어 있지만 설정 화면에 보이지 않고, 불러온 세이브에 Herm 비율이 있어도 0으로 되돌립니다.
`remote` 변형은 세이브 서버에서 열어야 동작합니다(파일을 직접 열면 저장이 실패합니다).

## 빌드

```bash
./build.sh                         # dist/ 에 네 파일 생성 (버전은 version 파일)
FORCE_VERSION=test ./build.sh      # 파일명의 버전 문자열만 바꿀 때
```

tweego는 `devTools/tweego/`에 번들된 바이너리를 씁니다(Linux/macOS/Windows x64). 네 변형 중 하나라도 실패하면 0이 아닌 코드로 끝나고 `dist/`에 임시 파일을 남기지 않습니다.

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

## 개발

```bash
python3 -m unittest discover -s tools/test -t .     # 빌드 비교 도구, 스토리 포맷 생성기
(cd tools/test && node --test)                       # 원격 저장 모듈(remote-idb.js)
(cd server && npm ci && npm test)                    # 세이브 서버
python3 tools/make_remote_format.py --check          # sugarcube-2-remote 가 최신인지
```

구조:

- `game/` 번역 소스. Herm 규칙이 들어 있고, 설정 UI는 `setup.features?.herm`로 가립니다.
- `features/herm-ui/features.js` Herm 빌드에만 포함되는 스위치 한 줄.
- `devTools/tweego/storyFormats/sugarcube-2-remote/` 원격 저장용 스토리 포맷. `idb` 저장 모듈이 게임 소스가 아니라 SugarCube 번들 안에 있어서, `tools/make_remote_format.py`가 원본 포맷의 `source`에 `tools/remote-idb.js`를 입혀 만듭니다. `remote-idb.js`나 원본 `format.js`를 바꾸면 다시 생성해 커밋합니다.
- `tools/verify_build.py A.html B.html [--allow ...] [--max-script-diff N]` 두 빌드를 passage 단위로 비교합니다.
- `server/` Express 세이브 서버와 Docker 설정.
- `docs/specs/`, `docs/plans/` 설계와 구현 계획. `docs/README-translation.md`는 번역판 원 저장소의 README 전문입니다.

## 한국어 번역판 안내

이 저장소는 [Tareun34/DoL_KrTranslation](https://github.com/Tareun34/DoL_KrTranslation)(아카라이브 DOL 채널 중심으로 진행된 번역, 0.5.12.13)을 포크한 것입니다. 원 번역 관리자는 저장소 공개 시점에 정기 유지보수를 종료했고, 이후 수정은 이 포크에서 이어집니다. 번역판의 안내문과 원작의 영문 README 전문은 [`docs/README-translation.md`](docs/README-translation.md)에 그대로 있습니다.

## 크레딧과 라이선스

- 원작: Vrelnir, [Degrees of Lewdity](https://vrelnir.blogspot.com/)
- 한국어 번역: 아카라이브 DOL 채널 번역팀, 저장소 공개 Tareun34
- 모드와 서버: 이 저장소

원작과 번역판에 적용된 **CC-BY-NC-SA** 라이선스를 그대로 따릅니다. 저작자 표시, 비영리, 동일 조건 변경 허락. 자세한 내용은 `LICENSE`를 참고하세요.
