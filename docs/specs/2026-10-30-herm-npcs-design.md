# Herm NPCs 패치 설계

작성일: 2026-10-30

## 의도

한글판 Degrees of Lewdity 0.5.12.13에 "NPC가 자지와 보지를 모두 가질 수 있는 옵션"을 넣는다.
외부에서 배포되는 "DoL-Herm NPCs Mod 0.5.11.9"와 같은 기능을 목표로 하되, 그 모드는
영문 0.5.11.9 기반의 통째 빌드라 지금 게임에 얹을 수 없다. 대신 원격 세이브 패치와 같은 방식,
즉 원본 HTML을 읽어 앵커를 치환한 사본을 만드는 두 번째 패치 스크립트로 만든다.

조사 결과 기반 게임에 이미 다음이 들어 있다.

- 랜덤 NPC 생성과 짐승 생성에 양쪽 생식기 분기가 있고, `$debugEnableHerms`가 1일 때만 탄다.
  이 플래그를 켜는 UI는 어디에도 없어서 현재는 개발자 모드 콘솔에서만 쓸 수 있다.
- `<<generate>>` 위젯은 `_gender is "h"` 인자를 받는다.
- `<<npcGenitals>>` 묘사 위젯과 네임드 NPC 임신 코드는 `gender is "h"`를 처리한다.

모드가 실제로 바꾼 것은 설정 UI, 랜덤 NPC 생성, 짐승 생성, 네임드 NPC 성별 결정, 플레이어
생식기 반응 억제 다섯 곳이다. 임신 통계와 세이브 버전 문자열 변경은 모드 기반 버전과 0.5.12.13의
차이에서 온 잡음이라 범위에서 뺀다. 0.5.12.13에는 모드 기반 버전에 없던 지속 NPC(`$per_npc`)가
있고 네임드 NPC와 같은 코드로 성별을 정하므로, 일관성을 위해 여기도 포함한다 (제 판단).

## 목표 / 비목표 / 안티목표

목표

- 설정 화면에서 여성 NPC와 남성 NPC 각각 "둘 다" 비율을 정할 수 있다.
- 새로 생성되는 랜덤 NPC, 짐승, 네임드 NPC가 그 비율대로 양쪽 생식기를 가진다.
- "둘 다" 비율이 20 이상이면 양성 플레이어의 생식기에 대한 NPC 반응을 억제한다.
- 원본은 건드리지 않고, 앵커가 하나라도 안 맞으면 아무것도 쓰지 않고 멈춘다.
- 원격 세이브 패치와 순서대로 적용해 한 HTML에 둘 다 반영된다.

비목표

- 기존 세이브에서 이미 성별이 정해진 네임드 NPC를 바꾸는 것. 새 캐릭터로 시작한다.
- 치트 메뉴 항목 추가.
- 이미지. 모드에 양쪽 생식기 전용 이미지는 없고, 패키지의 이미지 차이는 전부 버전 차이다.
- 모드의 세이브 버전 문자열(".h1") 처리.
- JS 보조 함수 `getSexesFromRandomGroup()`, `unableTakeVirginity()`의 극단값 판정. 이들은
  기존 두 설정이 0 또는 100일 때만 "전부/전무"를 판단하는데, 새 값은 보지 않는다. 모드도 손대지
  않았고 영향은 극단 설정에서의 그룹 조우 유형과 처녀성 판정뿐이라 그대로 둔다 (제 판단).

안티목표

- 기존 설정값의 의미가 바뀌는 것. "자지가 있는 여성의 비율" 등 기존 슬라이더는 그대로 동작해야 한다.
- 설정 내보내기/가져오기나 "조우마다 설정 무작위화" 기능이 새 값을 모르는 것.

## 제약

- 패치 대상은 `Degrees of Lewdity_kr.html` 0.5.12.13 한 파일. 트위 패시지는 HTML 안에
  `<tw-passagedata name="...">` 요소로 들어 있고 본문은 HTML 엔티티로 이스케이프되어 있다
  (`&lt; &gt; &quot; &#39; &amp;`). JS는 `<script>` 안에 그대로 있다.
- 0.5.12.13은 ionRangeSlider를 쓰지 않는다. 모드의 `doubleslider` 매크로는 그 라이브러리에
  의존하므로 가져올 수 없다. 숫자 슬라이더는 네이티브 `<input type="range">` 기반의
  `<<numberslider>>` 매크로뿐이다.
- 모드가 쓰는 `$initialGenderAppearance`는 0.5.12.13에 없다. 대응하는 값은
  `$player.gender_appearance`("m"/"f")이다.
- `<<rng>>` 매크로는 `$rng`에 1~100 정수를 넣는다. 네임드 NPC 코드는 `random(0, 99)`를 쓴다.
- Python 3.9 이상, 외부 의존성 없음. 기존 `patch/patch.py`와 같은 인자 체계.

## 결정된 사항

### 저장 변수 (제 판단)

새 값은 `$settings` 객체에 둔다. 루트 변수 `$dgchance`류는 이 버전에서 이미 `$settings`로
옮겨진 레거시이므로 모드의 루트 변수 방식을 따르지 않는다.

| 키 | 범위 | 기본값 | 의미 |
|---|---|---|---|
| `$settings.femaleNPCHermChance` | 0~100 | 0 | 여성 대명사 NPC 중 자지와 보지를 모두 가지는 비율 |
| `$settings.maleNPCHermChance` | 0~100 | 0 | 남성 대명사 NPC 중 자지와 보지를 모두 가지는 비율 |

기존 `femaleNPCPenisChance`(자지만), `maleNPCVaginaChance`(보지만)는 의미를 유지한다.
세 값의 관계는 "기존 값 우선, 둘 다는 남는 범위 안에서"다. 즉 여성 NPC 기준으로

- 자지만: `femaleNPCPenisChance`
- 둘 다: `min(femaleNPCHermChance, 100 - femaleNPCPenisChance)`
- 보지만: 나머지

합이 100을 넘게 설정해도 오류 없이 위 규칙으로 잘린다. 설정 화면 툴팁에 이 규칙을 적는다.

기본값은 세 겹으로 보장한다 (제 판단).

1. 새 게임: `gameStartOnly` 패시지의 기존 두 줄 바로 뒤에 `0`으로 추가한다.
2. 기존 세이브: `Widgets variablesVersionUpdate` 패시지에 이 게임의 관례대로 빠진 설정을 채우는
   블록을 추가한다. 기존 `<!-- 0.5.6.8  Fix for very old saves with beastMaleChance never defined -->`
   주석 바로 앞에 `<<if $settings.femaleNPCHermChance is undefined>>` 블록을 넣어 두 키를 0으로
   채운다. 이 위젯은 세이브를 불러올 때마다 돌므로, 패치 전 세이브도 로드 즉시 값을 가진다.
   이것이 없으면 `<<numberslider>>`가 기본값 `undefined`를 받아 설정 화면에서 매크로 오류를 내고,
   설정 가져오기와 조우별 무작위화는 `null`인 키를 건너뛴다.
3. 생성 코드와 슬라이더 인자는 그래도 `($settings.femaleNPCHermChance || 0)`처럼 읽어, 어떤 경로로
   값이 빠져도 오류가 나지 않게 한다.

`settingsObjects("general")`의 `settings` 하위 객체에서 `femaleNPCPenisChance`, `maleNPCVaginaChance`
항목 바로 뒤에 같은 형식(`min 0, max 100, decimals 0, displayName, randomize: "encounter"`)으로 두
항목을 추가한다. 내보내기/가져오기/무작위화/`settingsConvert`가 모두 이 객체의 키를 순회하므로
추가 매핑 없이 새 값을 인식한다.

### 설정 UI (제 판단)

모드의 3단 슬라이더 대신 기존 `<<numberslider>>` 두 개를 쓴다. 기존 "자지가 있는 여성의 비율"
블록 바로 뒤에 "자지와 보지가 모두 있는 여성의 비율" 블록을, "보지가 있는 남성의 비율" 블록
바로 뒤에 "자지와 보지가 모두 있는 남성의 비율" 블록을 넣는다. 각 새 블록은 기존 블록과 같은
`settingsToggleItem numberslider-inline` 마크업이고, 라벨 옆에 `(?)` 툴팁으로 잘림 규칙을 설명한다.

이유: 모드의 두 손잡이 슬라이더는 사라진 라이브러리에 묶여 있고, 직접 만들면 JS와 CSS가
수십 줄 늘어나는 데 비해 얻는 것은 시각적 표현뿐이다. 기능은 동일하다.

### 랜덤 NPC 생성 (`Widgets NPC Generation`)

`$debugEnableHerms` 조건이 있는 블록 전체를 아래 구조로 바꾼다. 여성 대명사 분기 기준이며
남성 분기는 대칭이다.

```
<<if $rng lte $settings.femaleNPCPenisChance>>
    자지만, gender "m"            (기존과 동일)
<<elseif $rng lte $settings.femaleNPCPenisChance + ($settings.femaleNPCHermChance || 0)>>
    자지와 보지, gender "h"
<<else>>
    보지만, gender "f"            (기존과 동일)
<</if>>
```

`$rng`가 1~100이므로 첫 분기는 기존과 완전히 같은 확률을 유지하고, 둘째 분기가 남는 범위에서
`femaleNPCHermChance`만큼 차지한다. 합이 100을 넘으면 둘째 분기가 자연히 잘린다.

### 짐승 생성 (`Widgets Beast Generation`)

같은 구조. 단 짐승은 `penis`/`vagina`에 `0`을 넣고 `gender`는 건드리지 않는다는 기존 관례를
유지한다.

### 네임드 NPC (`Widgets Named Npcs`)

"Set Gender" 블록 안의 두 `random(0, 99)` 분기를 바꾼다. 임신 중 검사(`getActivePregnancy`)는
그대로 둔다. 여성 대명사 기준:

```
<<set _r to random(0, 99)>>
<<if _r lt $settings.femaleNPCPenisChance>>        gender "m"
<<elseif _r lt $settings.femaleNPCPenisChance + ($settings.femaleNPCHermChance || 0)>>  gender "h"
<<else>>                                           gender "f"
```

기존 코드 `random(0,99) gte chance → f, else m`과 첫 분기 확률이 같다. 뒤따르는 "Set Genital
Existence" 블록은 `gender isnot "f"`/`isnot "m"` 식이라 "h"일 때 추가 수정 없이 양쪽이 생긴다.

### 지속 NPC (`Widgets Persistent NPCs`)

`updatePersistentNPCs` 위젯의 "Set Gender" 블록이 네임드 NPC와 같은 구조(`$per_npc[$_i]`,
`random(0, 99)`)이므로 같은 방식으로 바꾼다.

### 네임드 NPC 설정 화면 (추가, 2026-10-30 배포 후)

설정 화면의 네임드 NPC 항목에는 생식기 "양성" 라디오 버튼이 원본에 이미 있으나 `<<if $debug is 1>>`로
가려져 있다. 이 조건을 제거해 항상 보이게 하고, `settingsObjects("npc")`의 `gender` 항목에
`"h"`와 표시 문구 "양성"을 등록해 설정 내보내기·가져오기가 값을 보존하게 한다. 네임드 NPC의
생식기 존재 설정 코드는 `gender isnot "f"`/`isnot "m"` 식이라 "h"일 때 양쪽이 생긴다. 이 변경은
치트가 아니라 일반 설정이므로 비목표 "치트 메뉴 추가"에 해당하지 않는다. 기존 세이브에서도 네임드
NPC를 하나씩 양성으로 바꿀 수 있게 된다.

### 설정 가져오기 미리보기 (추가, 배포 후 발견)

`Widgets presets`의 `presetConfirm` 위젯은 `general.settings` 안의 퍼센트 키를 하드코딩된
`<<case>>` 목록으로 분류하고, 목록에 없는 키는 최상위에서만 찾다가 "인식할 수 없는 설정이므로
가져오지 않습니다"를 표시한다. 실제 적용(`importSettingsData`)은 `settingsObjects("general")`을
순회하므로 값은 들어가지만 메시지가 틀리다. 그 목록에 두 키를 추가한다.

### 플레이어 생식기 반응 억제 (`Widgets NPCs`, `man` 위젯)

기존

```
<<if $genitalReactionDisable>>
    <!-- No reaction -->
<<elseif $crossdressing is 2>> <!-- Herm PC -->
```

을

```
<<set _noReaction to false>>
<<if $genitalReactionDisable>>
    <<set _noReaction to true>>
<<elseif $crossdressing is 2>>
    <<if ($player.gender_appearance is "m" ? ($settings.maleNPCHermChance || 0) : ($settings.femaleNPCHermChance || 0)) gte 20>>
        <<set _noReaction to true>>
    <</if>>
<</if>>
<<if _noReaction>>
    <!-- No reaction -->
<<elseif $crossdressing is 2>> <!-- Herm PC -->
```

으로 바꾼다. `$crossdressing`은 2가 양성 플레이어다. 양성 기준 20은 사용자 결정이다. 모드에는
겉모습과 생식기가 다른 플레이어(`$crossdressing is 1`)에 대해 기존 비율이 50 이상이면 반응을 끄는
분기도 있었지만, 그러면 herm 비율이 0이어도 기존 설정만으로 동작이 바뀌어 안티목표("기존 설정값의
의미가 바뀌는 것")에 걸리므로 넣지 않는다 (최종 검토 후 결정). 뒤따르는 `<<elseif>>` 체인은
건드리지 않는다.

### 스크립트 구조

- 파일: `patch/herm.py`. 인자는 `[INPUT_HTML] [--out-dir DIR] [--check]`.
  기본 입력은 `../Degrees of Lewdity_kr.html`, 기본 출력 폴더는 `build/`.
- 치환 단위는 "패시지 이름 + 앵커". 각 패시지를 `<tw-passagedata ... name="이름"`으로 정확히
  한 번 찾고, 그 본문 안에서 앵커를 정확히 한 번 찾아 치환한다. 앵커와 치환문은 스크립트 안에
  사람이 읽는 형태(이스케이프 전)로 적고, 매칭 직전에 고정 테이블(`& < > " '`)로 이스케이프한다.
  JS 앵커(`settingsObjects`)는 이스케이프 없이 원문에서 찾는다.
- 모든 앵커 검사를 끝낸 뒤에만 파일을 쓴다. 실패 시 `missing anchor: 이름` 또는
  `ambiguous anchor: 이름 (n)`을 stderr에 내고 종료 코드 1. 성공 시 앵커마다 `ok  이름` 출력.
- 설정 UI, `gameStartOnly`, `settingsObjects`, 버전 업데이트는 "뒤에 삽입"이라 패치 후에도 앵커가
  남는다. 두 번 적용을 막기 위해 치환 전에 입력에 `femaleNPCHermChance`가 있으면
  `already patched`로 실패한다 (제 판단).
- `patch.py`의 `_find_once`, 출력 쓰기 방식(.tmp 후 `os.replace`)과 같은 관례를 따른다.
  공유 코드는 복사하지 않고 `patch.py`에서 import 해도 되고, 작게 복사해도 된다(빌더 재량).

### 적용 순서와 빌드 스크립트

순서는 **원본 → herm.py → patch.py** 로 고정한다.

```
python3 dol-remote-save/patch/herm.py                       # → build/Degrees of Lewdity_kr.html
python3 dol-remote-save/patch/patch.py "dol-remote-save/build/Degrees of Lewdity_kr.html"   # → dist/
```

두 패치의 앵커는 겹치지 않는다. herm.py는 트위 패시지 여덟 곳(설정, 랜덤 NPC 생성, 짐승 생성,
네임드 NPC, 지속 NPC, NPC 반응, 게임 시작 기본값, 버전 업데이트)과 JS의 `settingsObjects`만,
patch.py는 JS의 `idb` 모듈만 건드린다. 반대 순서도 동작하지만 한 순서로 고정한다.

`build.sh`를 저장소 루트(`dol-remote-save/`)에 두고 위 두 줄을 순서대로 실행한다. 첫 단계가
실패하면 둘째 단계를 실행하지 않는다. `build/`는 `.gitignore`에 추가한다.

### 문서

README에 "Herm NPCs 패치" 절을 추가한다. 무엇이 바뀌는지, `build.sh` 사용법, 원격 세이브 없이
herm.py만 쓰는 법, 기존 세이브에는 새 NPC부터 적용된다는 점을 적는다.

### 테스트

`patch/test/test_herm.py`, `unittest` 기반.

- 합성 HTML 픽스처: 필요한 패시지들의 해당 블록과 `settingsObjects` JS 조각만 담은 작은 HTML.
  본문은 실제 파일과 같은 방식으로 이스케이프해 둔다.
- 검사 항목: 모든 앵커가 치환되는지, `$debugEnableHerms`가 결과에 없는지, 새 설정 키 두 개가
  설정 UI와 `settingsObjects`와 `gameStartOnly`와 버전 업데이트에 들어갔는지, 두 번 적용하면
  `already patched`로 실패하는지, 앵커 하나를 깨뜨리면 그 이름이 오류에 나오는지, 패시지가
  중복이면 실패하는지.
- CLI 검사: `--check`는 파일을 쓰지 않고, 기본 실행은 입력과 같은 파일명으로 `--out-dir`에 쓴다.
- 체인 검사: herm.py 결과에 `patch.patch_html`을 적용해도 성공하는지.
- 실제 파일 검사: `../Degrees of Lewdity_kr.html`이 있으면 `--check`가 통과하는지. 없으면 skip.

## 빌더에게 맡기는 것

- 툴팁과 라벨의 정확한 한글 문구. 기존 설정 화면의 어투를 따른다.
- `herm.py` 내부에서 패시지 치환을 표현하는 자료구조.
- 픽스처의 구체적 내용과 크기.
