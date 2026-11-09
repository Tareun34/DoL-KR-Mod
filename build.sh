#!/usr/bin/env bash
# DoL-KR-Mod: 네 가지 변형(원본 / remote / herm / herm-remote)을 dist/ 에 빌드한다.
# 사용: ./build.sh            (버전은 version 파일, FORCE_VERSION 으로 덮어쓰기)
# 환경: BUILD_GAME_DIR (기본 game/) — 테스트용
set -euo pipefail
cd "$(dirname "$0")"

VER="${FORCE_VERSION:-$(tr -d '[:space:]' < version)}"
GAME_DIR="${BUILD_GAME_DIR:-game/}"
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

mkdir -p dist

# 변형 이름 | 추가 소스 | 스토리 포맷
build_variant() {
	local suffix="$1" extra="$2" format="$3"
	local name="DoL-KR ${VER}${suffix:+ $suffix}.html"
	local tmp="dist/.tmp-${suffix:-base}.html"
	echo "building: $name  (sources: $GAME_DIR $extra; format: $format)"
	# shellcheck disable=SC2086
	if ! "$TWEEGO" -f "$format" -o "$tmp" --head devTools/head.html --module modules "$GAME_DIR" $extra; then
		rm -f "$tmp"
		echo "build failed: ${suffix:-원본}" >&2
		exit 1
	fi
	mv -f "$tmp" "dist/$name"
}

build_variant ""            ""                 sugarcube-2
build_variant "remote"      ""                 sugarcube-2-remote
build_variant "herm"        "features/herm-ui/" sugarcube-2
build_variant "herm-remote" "features/herm-ui/" sugarcube-2-remote

echo "done:"
ls -la dist/
