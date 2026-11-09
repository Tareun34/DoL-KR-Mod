/* Herm 빌드 전용: 설정 화면의 양성 비율 UI를 켠다. game/ 쪽은 setup.features?.herm 로만 읽는다. */
setup.features = Object.assign(setup.features || {}, { herm: true });
