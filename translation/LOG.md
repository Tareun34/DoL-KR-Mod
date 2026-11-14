# 번역 2단계 작업 로그

설계: `docs/specs/2026-11-12-translation-stage2-design.md`. 계획: `docs/plans/2026-11-12-translation-stage2.md`.
묶음 표는 `python3 tools/translation_batches.py --root .`로 생성한 것이며(2026-11-12), 상태 열은 조율자가 손으로 갱신한다.

상태: `대기`(아직 안 함) · `진행`(에이전트 실행 중) · `완료`(검사·빌드·커밋 끝) · `되돌림`(검사 2회 실패로 `git checkout`) · `건너뜀`.

## 기존 비허용 조사 마커(이번 작업 범위 밖, 사용자 판단용)

허용 목록 밖 마커는 `trSelectPost`가 빈 문자열을 돌려줘 조사가 화면에서 사라진다. 2026-11-12 기준 `game/`에 다음이 있다(줄 번호는 당시 기준).

```
game/base-system/pregnancy/children-events.twee:1090:【에게】
game/overworld-forest/loc-forestshop/gwylan-ritual-sex.twee:4093:【이는】
game/overworld-forest/loc-forestshop/gwylan-ritual-sex.twee:4110:【이는】
game/overworld-forest/loc-forestshop/shop-events.twee:1753:【의】
game/overworld-forest/loc-forestshop/shop-events.twee:1755:【의】
game/overworld-forest/loc-forestshop/shop-events.twee:1755:【의】
game/overworld-forest/loc-forestshop/shop-events.twee:1757:【의】
game/overworld-plains/loc-estate/cards.twee:1921:【에게】
game/overworld-plains/loc-farm/cottage.twee:3065:【의】
game/overworld-plains/loc-farm/widgets.twee:3131:【에게】
game/overworld-plains/loc-farm/woodland.twee:2634:【도】
game/overworld-town/loc-home/ward.twee:189:【의】
game/overworld-town/loc-museum/painting-ward.twee:1176:【의】
game/overworld-town/loc-photography/main.twee:307:【의】
game/overworld-town/loc-photography/main.twee:309:【의】
game/overworld-town/loc-school/changing-rooms.twee:1172:【의】
game/overworld-town/loc-school/inspections.twee:370:【도】
game/overworld-town/loc-school/inspections.twee:566:【도】
game/overworld-town/loc-street/events.twee:9791:【의】
game/overworld-town/special-avery/main.twee:2697:【의】
game/overworld-town/special-avery/party.twee:1118:【의】
game/overworld-town/special-robin/main.twee:736:【도】
game/overworld-town/special-whitney/main.twee:10096:【과와】
game/overworld-town/special-whitney/main.twee:5859:【에게】
game/overworld-town/special-whitney/main.twee:5861:【에게】
game/overworld-town/special-whitney/main.twee:5863:【에게】
game/overworld-town/special-whitney/main.twee:5865:【에게】
game/overworld-town/special-whitney/main.twee:8546:【에게】
game/overworld-town/special-whitney/main.twee:8786:【의】
game/overworld-town/special-whitney/park.twee:799:【의】
game/overworld-town/special-whitney/street.twee:2643:【의】
game/overworld-town/special-whitney/street.twee:2703:【의】
game/overworld-underground/loc-underground/robin.twee:205:【의】
game/overworld-underground/loc-underground/robin.twee:288:【의】
game/special-fishing/fishing-text.twee:1532:【에게】
```

## 코드 측 보정 후보(번역 커밋으로는 못 고치는 것, 1차 뒤 별도 처리)

- `base-system/widgets.twee` 거리 이름: `<<print _location.toUpperFirst()>> 가` → `getMapNameKr(...)`로 한글 거리명.
- `base-system/tending.twee` 335: `$_plant.tending.planting_bed` 값(earth/water)이 영어로 찍힘.
- `$NPCList[_n].penisdesc` / `breastsdesc` 를 산문에서 직접 찍는 자리(bodywriting 1005, ejaculation 다수, 이후 전투 파일들): 옛 번역은 `window.KR.getPenisDescKr(...)`로 감쌌으나 번역 커밋에서는 변수 그대로 둠. 해결책 후보: 이 값들을 `kr_dict.js` 화면번역 사전에 넣어 후처리로 치환.
- `base-combat/man-combat.twee` 등 전투 파일: `_args[0]`/`$_hand`(left/right)와 `$_toy` 도구명을 산문에 직접 찍음. 옛 번역은 `<<print … ? "왼손" : "오른손">>`·`window.KR.getToolKr()` 래퍼. 후보: kr_dict 화면번역 사전에 도구명·left/right 추가.
- `base-system/effect.js` 508: 최면 특성 이름 `trait.toUpperFirst()` 영어 그대로(옛 번역과 동일).

## 묶음

| 묶음 | 단계 | 파일 | 산문 줄 | 상태 | 메모 |
|---|---|---|---|---|---|
| P1-01 | 1 | game/base-system/settings.twee | 436 | 완료 | 남은 영어 61줄(코드·주석). skinToneRange 핸들 라벨은 data-tip 결합 때문에 영어 유지. 표기: monster people→수인, NNPC→네임드 NPC |
| P1-02 | 1 | game/base-system/widgets.twee | 265 | 완료 | 남은 영어 105줄(코드·주석). thugs→베일리의 부하들. 거리 이름이 'High 가'처럼 찍힘: getMapNameKr로 코드 측 보정 후보 |
| P1-03 | 1 | game/base-system/overlays/social.twee<br>game/base-system/text.js | 430 | 완료 | 남은 영어 180/216줄(코드). text.js 템플릿 `${NPCName}'s` → 기존 한글 줄과 같은 KR 헬퍼 호출로 맞춤. 표기: Thug Anger→폭력배의 분노, Research→조사, Calligraphy→서예 |
| P1-04 | 1 | game/base-system/overlays/journal.twee<br>game/base-system/tips.twee<br>game/base-system/overlays/traits.twee<br>game/base-system/tending.twee | 419 | 완료 | 남은 영어는 코드만. tending의 planting_bed 값(earth/water)이 영어로 찍힘: 코드 측 보정 후보. 표기: Farming→농사, recipe→요리법 |
| P1-05 | 1 | game/base-system/pregnancy/events.twee<br>game/base-system/mirror.twee<br>game/base-system/overlays/statistics.twee<br>game/base-system/overlays/options.twee<br>game/base-system/overlays/cheats.twee<br>game/base-system/named-npcs.twee<br>game/base-system/kitchen.twee<br>game/base-system/overlays/characteristics.twee<br>game/base-system/bodywriting.twee<br>game/base-system/overlays/feats-ui.twee<br>game/base-system/pregnancy/children-events.twee<br>game/base-system/effect.js<br>game/base-system/orgasm.twee<br>game/base-system/pregnancy/containers.twee<br>game/base-system/weather/passout-scenes.twee<br>game/base-system/overlays/saves-export-import.twee<br>game/base-system/questmarkers.js<br>game/base-system/pregnancy/pregnancy.twee | 236 | 완료 | 18파일 ok. bodywriting 1005: 옛 번역의 KR 헬퍼 호출(getPenisDescKr)은 코드 변경이라 미적용 → 코드 측 보정 후보. 표기: Genitalia Fame→생식기 소문, Pickaxes→곡괭이 |
| P1-06 | 1 | game/base-combat/speech/speech-whitney.twee | 2247 | 완료 | 513줄 번역, 남은 영어 0(코드 2줄). 첫 에이전트는 내용상 거절, 맥락 명시 후 재시도 성공. either(\"slut\",…) 류는 관례대로 한글 |
| P1-07 | 1 | game/base-combat/ejaculation/ejaculation.twee | 2190 | 완료 | 808줄 번역, 남은 영어 0(코드·주석 89줄). strap-on→페니스 밴드. $NPCList[].penisdesc/breastsdesc 영어 출력 → 코드 측 보정 후보 |
| P1-08 | 1 | game/base-combat/speech/speech-avery.twee | 1950 | 완료 | 591줄 번역, 남은 영어 0(코드 11줄). 2650행 깨진 span 태그는 원문 버그, 그대로 둠 |
| P1-09 | 1 | game/base-combat/speech/speech-sydney.twee | 1230 | 건너뜀 | 에이전트가 내용(학교 배경 인물의 성적 장면)을 이유로 거절. 영어 309줄 그대로. 1차 끝에 재시도 |
| P1-10 | 1 | game/base-combat/speech/speech-gwylan.twee | 810 | 완료 | 215줄 번역, 남은 영어 0(코드 6줄). rut/heat→러트/발정기 |
| P1-11 | 1 | game/base-combat/ejaculation/ejaculation-gloryhole.twee | 691 | 완료 | 165줄 번역, 남은 영어 0(헤더·주석 3줄) |
| P1-12 | 1 | game/base-combat/ejaculation/ejaculation-wall.twee | 588 | 완료 | 126줄 번역, 남은 영어 0(헤더 1줄) |
| P1-13 | 1 | game/base-combat/speech/speech-robin.twee | 513 | 완료 | 141줄 번역, 남은 영어 0(코드 7줄) |
| P1-14 | 1 | game/base-combat/speech/speech-bailey.twee | 363 | 완료 | 118줄 번역, 남은 영어 0(헤더 1줄) |
| P1-15 | 1 | game/base-combat/man-combat.twee | 356 | 완료 | 177줄 번역, 남은 영어 0(코드·주석 83줄). _args[0] 손(left/right)·$_toy 도구명이 영어로 찍힘 → 코드 측 보정 후보 |
| P1-16 | 1 | game/base-combat/actions-text.twee | 346 | 완료 | 202줄 번역, 남은 영어 0(코드 25줄) |
| P1-17 | 1 | game/base-combat/ejaculation/ejaculation-pillory.twee | 263 | 완료 | 70줄 복원(옛 번역 1:1), 남은 영어 0 |
| P1-18 | 1 | game/base-combat/speech/reaction-avery.twee<br>game/base-combat/audience.twee | 435 | 완료 | 약 200줄 번역/복원, 남은 영어 0(코드 20줄). Hound→하운드 |
| P1-19 | 1 | game/base-combat/speech/speech-kylar.twee<br>game/base-combat/effects.twee<br>game/base-combat/beast.twee<br>game/base-combat/speech/speech.twee<br>game/base-combat/speech/speech-alex.twee | 423 | 진행 |  |
| P1-20 | 1 | game/base-combat/speech/speech-morgan.twee<br>game/base-combat/speech/speech-leighton.twee<br>game/base-combat/speech/reaction-sydney.twee<br>game/base-combat/speech/reaction-gwylan.twee<br>game/base-combat/speech/speech-harper.twee<br>game/base-combat/speech/speech-eden.twee<br>game/base-combat/init.twee<br>game/base-combat/actionsGeneration.twee<br>game/base-combat/actions-penis.twee<br>game/base-combat/tentacles/tentacle-adv.twee<br>game/base-combat/machine/machine.twee<br>game/base-combat/actions-anus.twee<br>game/base-combat/actions-hands.twee<br>game/base-combat/effects-disabled.twee<br>game/base-combat/npc-damage.twee<br>game/base-combat/audienceswarm.twee<br>game/base-combat/ejaculation/ejaculation-eden.twee<br>game/base-combat/ejaculation/ejaculation-kylar.twee<br>game/base-combat/ejaculation/ejaculation-leighton.twee<br>game/base-combat/ejaculation/ejaculation-sydney.twee<br>game/base-combat/stalk/stalk.twee | 353 | 진행 |  |
| P1-21 | 1 | game/overworld-town/loc-street/events.twee | 2536 | 대기 |  |
| P1-22 | 1 | game/overworld-town/special-avery/main.twee | 1050 | 대기 |  |
| P1-23 | 1 | game/overworld-town/loc-alley/park.twee | 1008 | 대기 |  |
| P1-24 | 1 | game/overworld-town/loc-temple/library.twee | 965 | 대기 |  |
| P1-25 | 1 | game/overworld-town/loc-home/main.twee | 555 | 대기 |  |
| P1-26 | 1 | game/overworld-town/loc-home/rent.twee | 532 | 대기 |  |
| P1-27 | 1 | game/overworld-town/loc-museum/museumAntiques.twee | 500 | 대기 |  |
| P1-28 | 1 | game/overworld-town/loc-street/widgets.twee | 417 | 대기 |  |
| P1-29 | 1 | game/overworld-town/loc-flats/main.twee | 285 | 대기 |  |
| P1-30 | 1 | game/overworld-town/special-sydney/main.twee | 237 | 대기 |  |
| P1-31 | 1 | game/overworld-town/loc-school/library.twee<br>game/overworld-town/special-kylar/main.twee | 381 | 대기 |  |
| P1-32 | 1 | game/overworld-town/loc-school/main.twee<br>game/overworld-town/loc-photography/jobs.twee<br>game/overworld-town/loc-temple/widgets.twee | 402 | 대기 |  |
| P1-33 | 1 | game/overworld-town/loc-school/widgets-events.twee<br>game/overworld-town/loc-museum/main.twee<br>game/overworld-town/special-avery/mansion housework.twee<br>game/overworld-town/special-whitney/main.twee<br>game/overworld-town/loc-beach/widgets.twee | 400 | 대기 |  |
| P1-34 | 1 | game/overworld-town/loc-home/event-widgets.twee<br>game/overworld-town/loc-temple/main.twee<br>game/overworld-town/loc-street/domus.twee<br>game/overworld-town/loc-school/exam.twee<br>game/overworld-town/loc-home/events.twee<br>game/overworld-town/loc-pound/main.twee<br>game/overworld-town/loc-school/classes/swimming-events.twee<br>game/overworld-town/loc-street/starfish.twee<br>game/overworld-town/special-robin/main.twee<br>game/overworld-town/loc-temple/events.twee<br>game/overworld-town/special-avery/widgets mansion.twee<br>game/overworld-town/loc-cafe/main.twee<br>game/overworld-town/loc-adultshop/sex-shop-menu.twee | 436 | 대기 |  |
| P1-35 | 1 | game/overworld-town/loc-shop/tailor.twee<br>game/overworld-town/loc-temple/quarters.twee<br>game/overworld-town/loc-alley/widgets.twee<br>game/overworld-town/special-alex/main.twee<br>game/overworld-town/loc-cafe/chef.twee<br>game/overworld-town/loc-school/detention.twee<br>game/overworld-town/loc-town-hall/main.twee<br>game/overworld-town/loc-flats/work.twee<br>game/overworld-town/loc-home/garden.twee<br>game/overworld-town/loc-pound/abduction.twee<br>game/overworld-town/loc-school/changing-rooms.twee<br>game/overworld-town/special-avery/cards.twee<br>game/overworld-town/loc-beach/main.twee<br>game/overworld-town/loc-pub/main.twee<br>game/overworld-town/loc-school/inspections.twee<br>game/overworld-town/loc-school/widgets.twee<br>game/overworld-town/loc-domus-homes/work.twee<br>game/overworld-town/loc-arcade/main.twee<br>game/overworld-town/loc-museum/painting-snake.twee<br>game/overworld-town/loc-school/changing-rooms-events.twee<br>game/overworld-town/loc-office/meeting.twee<br>game/overworld-town/loc-pound/widgets.twee<br>game/overworld-town/special-whitney/street.twee<br>game/overworld-town/loc-photography/model.twee<br>game/overworld-town/loc-temple/confess.twee<br>game/overworld-town/special-kylar/stockholm.twee<br>game/overworld-town/loc-alley/events.twee<br>game/overworld-town/loc-shop/main.twee<br>game/overworld-town/loc-street/oxford.twee<br>game/overworld-town/special-sydney/temple.twee<br>game/overworld-town/loc-brothel/main.twee<br>game/overworld-town/loc-hospital/abduction.twee<br>game/overworld-town/loc-school/classes/housekeeping-events.twee<br>game/overworld-town/loc-school/maths-project.twee<br>game/overworld-town/loc-sea/widgets.twee<br>game/overworld-town/loc-street/bondage-widgets.twee<br>game/overworld-town/loc-temple/prayer.twee<br>game/overworld-town/special-avery/mansion chase.twee<br>game/overworld-town/special-whitney/home.twee<br>game/overworld-town/special-whitney/widgets.twee<br>game/overworld-town/loc-compound/main.twee<br>game/overworld-town/loc-flats/auction.twee<br>game/overworld-town/loc-street/connudatus.twee | 446 | 대기 |  |
| P1-36 | 1 | game/overworld-town/loc-strip club/events.twee<br>game/overworld-town/special-avery/mansion return.twee<br>game/overworld-town/loc-brothel/shows.twee<br>game/overworld-town/loc-dance-studio/main.twee<br>game/overworld-town/loc-park/run.twee<br>game/overworld-town/loc-prison/main.twee<br>game/overworld-town/loc-temple/garden.twee<br>game/overworld-town/special-avery/mansion.twee<br>game/overworld-town/special-kylar/halloween.twee<br>game/overworld-town/loc-domus-homes/demon.twee<br>game/overworld-town/loc-flats/canal.twee<br>game/overworld-town/loc-hospital/parasite-removal.twee<br>game/overworld-town/loc-museum/painting-snake-cell.twee<br>game/overworld-town/loc-school/classes/english-events.twee<br>game/overworld-town/loc-school/hallways.twee<br>game/overworld-town/special-avery/valentines.twee<br>game/overworld-town/special-robin/widgets.twee<br>game/overworld-town/loc-adultshop/intro.twee<br>game/overworld-town/loc-beach/events.twee<br>game/overworld-town/loc-beach/phallus-project.twee<br>game/overworld-town/loc-chalets/end.twee<br>game/overworld-town/loc-dance-studio/job.twee<br>game/overworld-town/loc-domus-homes/nude.twee<br>game/overworld-town/loc-domus-homes/skulduggery.twee<br>game/overworld-town/loc-home/ward.twee<br>game/overworld-town/loc-office/exec.twee<br>game/overworld-town/loc-office/main.twee<br>game/overworld-town/loc-park/robin.twee<br>game/overworld-town/loc-park/widgets.twee<br>game/overworld-town/loc-police/pillory.twee<br>game/overworld-town/loc-police/widgets.twee<br>game/overworld-town/loc-school/classes/science-events.twee<br>game/overworld-town/loc-sea/main.twee<br>game/overworld-town/loc-shop/clothing-v2.twee<br>game/overworld-town/special-avery/gifts.twee<br>game/overworld-town/special-avery/party.twee<br>game/overworld-town/special-avery/skyscraper.twee<br>game/overworld-town/special-leighton/main.twee<br>game/overworld-town/special-robin/lemonade.twee<br>game/overworld-town/loc-baitshop/main.twee<br>game/overworld-town/loc-flats/events.twee<br>game/overworld-town/loc-market/widgets.twee<br>game/overworld-town/loc-photography/widgets.twee<br>game/overworld-town/loc-pirates/attack.twee<br>game/overworld-town/loc-prison/canteen.twee<br>game/overworld-town/loc-prison/intro.twee<br>game/overworld-town/loc-school/special-night.twee<br>game/overworld-town/loc-shop/toyShop.twee<br>game/overworld-town/loc-street/cliff.twee<br>game/overworld-town/special-robin/walk.twee<br>game/overworld-town/special-sam/main.twee<br>game/overworld-plains/loc-farm/woodland.twee<br>game/overworld-plains/loc-livestock/barn.twee<br>game/overworld-plains/loc-farm/widgets.twee | 440 | 대기 |  |
| P1-37 | 1 | game/overworld-plains/loc-livestock/main.twee<br>game/overworld-plains/loc-farm/work.twee<br>game/overworld-plains/loc-moor/events.twee<br>game/overworld-plains/loc-farm/events_road.twee<br>game/overworld-plains/loc-moor/widgets.twee<br>game/overworld-plains/loc-livestock/jobs.twee<br>game/overworld-plains/loc-livestock/field.twee<br>game/overworld-plains/loc-farm/main.twee<br>game/overworld-plains/loc-moor/main.twee<br>game/overworld-plains/loc-riding/main.twee<br>game/overworld-plains/loc-bird/hunts.twee<br>game/overworld-plains/loc-livestock/intro.twee<br>game/overworld-plains/loc-maze/main.twee<br>game/overworld-plains/loc-bird/gifts.twee<br>game/overworld-plains/loc-farm/cottage.twee<br>game/overworld-plains/loc-estate/cards.twee<br>game/overworld-plains/loc-estate/cards_widgets.twee<br>game/overworld-plains/loc-bird/main.twee<br>game/overworld-plains/loc-livestock/widgets.twee<br>game/overworld-plains/loc-estate/main.twee<br>game/overworld-plains/loc-moor/abduction.twee<br>game/overworld-plains/loc-bird/widgets.twee<br>game/overworld-plains/loc-estate/sabotage.twee<br>game/overworld-plains/loc-farm/events.twee<br>game/overworld-plains/loc-farm/kennel.twee<br>game/overworld-plains/loc-manors/skulduggery.twee<br>game/overworld-plains/loc-farm/exhibitionism.twee<br>game/overworld-plains/loc-farm/gifts.twee | 328 | 대기 |  |
| P1-38 | 1 | game/overworld-forest/loc-lake/underwater.twee<br>game/overworld-forest/loc-forest/widgets.twee<br>game/overworld-forest/loc-forest/events.twee<br>game/overworld-forest/loc-forestshop/gwylan-requests.twee | 446 | 대기 |  |
| P1-39 | 1 | game/overworld-forest/loc-cabin/intro.twee<br>game/overworld-forest/loc-forestshop/gwylan-ritual-beast.twee<br>game/overworld-forest/loc-forestshop/gwylan-clothes.twee<br>game/overworld-forest/loc-asylum/depths.twee<br>game/overworld-forest/loc-forestshop/gwylan-ritual-sex.twee<br>game/overworld-forest/loc-forestshop/gwylan-events.twee<br>game/overworld-forest/loc-wolfpack/widgets.twee<br>game/overworld-forest/loc-forestshop/shop-events.twee<br>game/overworld-forest/loc-lake/ivory/underwater-prison.twee<br>game/overworld-forest/loc-forestshop/widgets.twee<br>game/overworld-forest/loc-forestshop/gwylan-hypnosis.twee<br>game/overworld-forest/loc-lake/mason.twee<br>game/overworld-forest/loc-wolfpack/events.twee<br>game/overworld-forest/loc-asylum/main.twee<br>game/overworld-forest/loc-bog/widgets.twee<br>game/overworld-forest/loc-cabin/hunt.twee<br>game/overworld-forest/loc-lake/ivory/main.twee<br>game/overworld-forest/loc-lake/widgets.twee<br>game/overworld-forest/loc-wolfpack/introduction.twee<br>game/overworld-forest/loc-wolfpack/main.twee<br>game/overworld-forest/loc-wolfpack/pregnancyEvents.twee<br>game/overworld-forest/loc-asylum/widgets.twee<br>game/overworld-forest/loc-cabin/main.twee<br>game/overworld-forest/loc-churchyard/events.twee<br>game/overworld-forest/loc-forestshop/shop-hunt.twee<br>game/overworld-forest/loc-lake/ivory/widgets.twee<br>game/overworld-forest/loc-lake/main.twee<br>game/overworld-forest/loc-wolfpack/wolf.twee | 313 | 대기 |  |
| P1-40 | 1 | game/overworld-underground/loc-sewers/morgan.twee | 295 | 대기 |  |
| P1-41 | 1 | game/overworld-underground/loc-mines/widgets.twee | 284 | 대기 |  |
| P1-42 | 1 | game/overworld-underground/loc-mines/main.twee<br>game/overworld-underground/loc-underground/robin.twee<br>game/overworld-underground/loc-cave/events.twee<br>game/overworld-underground/loc-underground/events.twee<br>game/overworld-underground/loc-cave/widgets.twee<br>game/overworld-underground/loc-sewers/main.twee<br>game/overworld-underground/loc-sewers/old-sewers-events.twee<br>game/overworld-underground/loc-sewers/widgets.twee<br>game/overworld-underground/loc-underground/main.twee<br>game/overworld-underground/loc-cave/pub.twee | 316 | 대기 |  |
| P1-43 | 1 | game/04-Variables/foodstuff.js | 442 | 대기 |  |
| P1-44 | 1 | game/04-Variables/feats.js<br>game/04-Variables/colours.js<br>game/04-Variables/variables-static.twee<br>game/04-Variables/presets.twee<br>game/04-Variables/variables-passageFooter.twee<br>game/special-dance/effects.twee<br>game/special-dance/actions.twee<br>game/special-fishing/fishing-text.twee<br>game/special-fishing/pier/whitney.twee<br>game/special-fishing/fishing-minigame.twee<br>game/special-fishing/moor/fox.twee<br>game/special-fishing/beach/main.twee<br>game/special-fishing/pier/main.twee<br>game/special-fishing/beach/tentacles.twee<br>game/special-fishing/moor/catch-fish.twee<br>game/special-fishing/moor/hikers.twee<br>game/special-fishing/pier/fisher.twee<br>game/special-fishing/shared/bait.twee | 441 | 대기 |  |
| P1-45 | 1 | game/special-masturbation/effects.js<br>game/special-masturbation/widgets.twee<br>game/special-masturbation/main.twee<br>game/base-clothing/init.js<br>game/base-clothing/wardrobes.twee<br>game/base-clothing/clothing-special.js<br>game/base-clothing/clothing-feet.js<br>game/03-JavaScript/04-Pregnancy/children-story-functions.js<br>game/03-JavaScript/debug-menu.js<br>game/03-JavaScript/02-Helpers/macros.js<br>game/03-JavaScript/sexToysInventory.js<br>game/01-config/sugarcubeConfig.js<br>game/01-config/start.twee | 439 | 대기 |  |
| P1-46 | 1 | game/base-debug/scene-viewer.twee<br>game/base-debug/clothes-testing.twee<br>game/flavour-text-generators/seasonal-events.twee<br>game/special-exhibition/main.twee<br>game/special-exhibition/night.twee<br>game/special-templates/main.twee | 243 | 대기 |  |
| P2-01 | 2 | game/base-system/stat-changes.js<br>game/base-system/widgets.js<br>game/base-system/caption.twee<br>game/base-combat/npc-generation.twee<br>game/base-combat/speech/speech-zephyr.twee<br>game/overworld-town/special-kylar/manor.twee | 368 | 대기 |  |
| P2-02 | 2 | game/overworld-town/loc-arcade/widgets.twee<br>game/overworld-town/loc-bus/widgets.twee<br>game/overworld-town/special-nightmares/main.twee | 425 | 대기 |  |
| P2-03 | 2 | game/overworld-town/loc-museum/painting-ward.twee<br>game/overworld-town/loc-temple/soup-kitchen.twee<br>game/overworld-town/loc-bus/main.twee<br>game/overworld-town/loc-flats/skulduggery.twee<br>game/overworld-town/special-sydney/widgets.twee<br>game/overworld-forest/loc-forestshop/gwylan-functions.js<br>game/04-Variables/canvasmodel-main.js<br>game/04-Variables/variables-versionUpdate.twee | 435 | 대기 |  |
| P2-04 | 2 | game/04-Variables/variables-start.twee<br>game/special-fishing/fishing.js<br>game/special-fishing/coast-path/main.twee<br>game/special-fishing/forest-lake/main.twee<br>game/special-fishing/moor/main.twee<br>game/base-clothing/clothing-handheld.js<br>game/base-clothing/clothing-lower.js<br>game/base-clothing/clothing-upper.js<br>game/base-clothing/clothing-head.js<br>game/base-clothing/clothing-sets.twee | 438 | 대기 |  |
| P2-05 | 2 | game/03-JavaScript/save.js | 1004 | 대기 |  |
| P2-06 | 2 | game/03-JavaScript/ingame.js<br>game/03-JavaScript/time.js<br>game/03-JavaScript/04-Pregnancy/story-functions.js<br>game/03-JavaScript/04-Pregnancy/child-generator.js<br>game/03-JavaScript/04-Pregnancy/pregnancy-constants.js<br>game/03-JavaScript/time-macros.js<br>game/03-JavaScript/ui.js<br>game/03-JavaScript/05-renderer/21-close-options.js<br>game/03-JavaScript/weather/02-main/02-body-temperature.js<br>game/03-JavaScript/sextoys.js<br>game/03-JavaScript/weather/03-canvas/01-src/00-classes/sky-canvas.js<br>game/special-templates/fishing-event-loop.twee | 251 | 대기 |  |
| P3-01 | 3 | game/overworld-town/loc-bus/thug.twee<br>game/overworld-underground/loc-mines/MineMaze.js<br>game/overworld-underground/loc-mines/birth.twee | 409 | 대기 |  |
| P3-02 | 3 | game/overworld-underground/loc-mines/cleaning.twee<br>game/overworld-underground/loc-mines/escape.twee<br>game/overworld-underground/loc-mines/minecarts.twee<br>game/overworld-underground/loc-mines/mining.twee<br>game/overworld-underground/loc-mines/night.twee<br>game/overworld-underground/loc-mines/passout.twee | 386 | 대기 |  |
| P3-03 | 3 | game/overworld-underground/loc-mines/punishment.twee<br>game/overworld-underground/loc-mines/revolt.twee<br>game/base-combat/speech/reaction-alex.twee<br>game/base-combat/speech/reaction-blackwolf.twee<br>game/base-combat/speech/reaction-eden.twee<br>game/base-combat/speech/reaction-greathawk.twee<br>game/base-combat/speech/reaction-kylar.twee<br>game/base-combat/speech/reaction-robin.twee<br>game/base-combat/speech/reaction-whitney.twee<br>game/base-combat/speech/named-npcs-speech.twee<br>game/03-JavaScript/beast-settings.js<br>game/03-JavaScript/settings-ui.js | 427 | 대기 |  |
| P3-04 | 3 | game/03-JavaScript/weather/03-canvas/02-lib/00-effects/effects-fireworks.js<br>game/03-JavaScript/weather/03-canvas/02-lib/01-layers/layer-fireworks.js<br>game/base-combat/speech.js<br>game/base-combat/tentacles/tentacle-combat.js<br>game/base-debug/sky-testing.twee | 128 | 대기 |  |
