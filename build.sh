#!/usr/bin/env bash
# DoL-KR-Mod: 변형(원본 / remote / herm / herm-remote)을 dist/ 에 빌드한다.
# 사용: ./build.sh                 로컬 배포용 herm-remote 하나만 (기본)
#       ./build.sh all             네 변형 전부 (배포본 묶을 때)
#       ./build.sh base remote     지정한 변형만 (base = 원본)
#       버전은 version 파일, FORCE_VERSION 으로 덮어쓰기
# 변형은 dist/.build/ 에 먼저 만들고, 전부 성공했을 때만 dist/ 로 한꺼번에 옮긴다.
# 하나라도 실패하면 dist/ 는 손대지 않고 종료 코드 1.
# 테스트용 환경 변수: BUILD_GAME_DIR (기본 game/), BUILD_BREAK=<변형 접미사> (그 변형을 일부러 실패시킴)
set -euo pipefail
cd "$(dirname "$0")"

VER="${FORCE_VERSION:-$(tr -d '[:space:]' < version)}"
GAME_DIR="${BUILD_GAME_DIR:-game/}"
STAGE="dist/.build"
export TWEEGO_PATH=devTools/tweego/storyFormats

pick_tweego() {
	if command -v tweego >/dev/null 2>&1; then echo tweego; return; fi
	case "$(uname -m)" in
		x86_64 | amd64)
			if [ "$(uname -s)" = "Darwin" ]; then echo ./devTools/tweego/tweego_osx64
			elif [ "${OSTYPE:-}" = "msys" ]; then echo ./devTools/tweego/tweego_win64.exe
			else echo ./devTools/tweego/tweego_linux64; fi ;;
		x86 | i[3-6]86)
			if [ "$(uname -s)" = "Darwin" ]; then echo ./devTools/tweego/tweego_osx86
			elif [ "${OSTYPE:-}" = "msys" ]; then echo ./devTools/tweego/tweego_win86.exe
			else echo ./devTools/tweego/tweego_linux86; fi ;;
		arm64 | aarch64)
			if [ "$(uname -s)" = "Darwin" ]; then echo ./devTools/tweego/tweego_m1
			else echo "tweego: no bundled binary for $(uname -m) $(uname -s); install tweego on PATH" >&2; exit 2; fi ;;
		*) echo "tweego: no bundled binary for $(uname -m); install tweego on PATH" >&2; exit 2 ;;
	esac
}
TWEEGO="$(pick_tweego)"

if ! python3 tools/make_remote_format.py --check >/dev/null; then
	echo "sugarcube-2-remote가 오래됨: python3 tools/make_remote_format.py 실행" >&2
	exit 1
fi

rm -rf "$STAGE"
mkdir -p "$STAGE"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

# 변형 접미사 | 추가 소스 | 스토리 포맷
build_variant() {
	local suffix="$1" extra="$2" format="$3"
	local name="DoL-KR ${VER}${suffix:+ $suffix}.html"
	if [ "${BUILD_BREAK:-}" = "${suffix:-base}" ]; then format="nope"; fi
	echo "building: $name  (sources: $GAME_DIR $extra; format: $format)"
	# shellcheck disable=SC2086
	if ! "$TWEEGO" -f "$format" -o "$STAGE/$name" --head devTools/head.html --module modules "$GAME_DIR" $extra; then
		echo "build failed: ${suffix:-원본}" >&2
		exit 1
	fi
}

VARIANTS=("$@")
if [ "${#VARIANTS[@]}" -eq 0 ]; then VARIANTS=(herm-remote); fi
if [ "${VARIANTS[0]}" = "all" ]; then VARIANTS=(base remote herm herm-remote); fi
for v in "${VARIANTS[@]}"; do
	case "$v" in
		base)        build_variant ""            ""                  sugarcube-2 ;;
		remote)      build_variant "remote"      ""                  sugarcube-2-remote ;;
		herm)        build_variant "herm"        "features/herm-ui/" sugarcube-2 ;;
		herm-remote) build_variant "herm-remote" "features/herm-ui/" sugarcube-2-remote ;;
		*) echo "unknown variant: $v (base | remote | herm | herm-remote | all)" >&2; exit 2 ;;
	esac
done

# 전부 성공: 한꺼번에 교체
for f in "$STAGE"/*.html; do mv -f "$f" "dist/$(basename "$f")"; done

echo "done:"
ls -la dist/
