/*
 * 청약 규칙 데이터 (2026년 10월 기준으로 정리)
 * 제도나 소득 기준이 바뀌면 이 파일만 고치면 돼.
 */
(function (root) {
  'use strict';

  const RULES = {
    asOf: '2026.10',

    // 도시근로자 가구원수별 가구당 월평균소득 100% (원)
    // 출처: SH공사 '2026년 도시근로자 가구원수별 가구당 월평균소득 기준'
    incomeYear: 2026,
    income100: { 1: 3813363, 2: 5866270, 3: 8168429, 4: 8802202, 5: 9326985, 6: 9906263 },

    // 수도권 (1순위 가입기간 1년)
    capital: ['서울', '인천', '경기'],

    // 민영주택 1순위 예치금 (만원) — 청약자 거주지 기준
    // A: 특별시·부산, B: 그 밖의 광역시, C: 그 밖의 시·군
    depositGroup: { 서울: 'A', 부산: 'A', 인천: 'B', 대구: 'B', 광주: 'B', 대전: 'B', 울산: 'B' },
    depositGroupName: { A: '서울·부산', B: '그 밖의 광역시', C: '그 밖의 시·군' },
    deposit: {
      A: [300, 600, 1000, 1500],
      B: [250, 400, 700, 1000],
      C: [200, 300, 400, 500],
    },
    areaNames: ['전용 85㎡ 이하', '전용 102㎡ 이하', '전용 135㎡ 이하', '모든 면적'],

    // 1순위 통장 가입기간(개월) / 공공주택 납입 회차
    rank1Months: { regulated: 24, capital: 12, local: 6 },
    rank1Payments: { regulated: 24, capital: 12, local: 6 },

    // 특별공급 소득 상한 (도시근로자 월평균소득 대비 %)
    // 출처: 찾기쉬운 생활법령정보 '소득기준' (2026.9.15 기준), 민영 신생아 특공(2026.6.15 시행)
    incomeLimit: {
      private: {
        newlywed: 140, newlywedDual: 160,
        firstHome: 160, firstHomePriority: 130,
        newborn: 160, newbornPriority: 130,
      },
      public: {
        newlywed: 140, newlywedDual: 160,
        firstHome: 130,
        newborn: 130,
        multiChild: 120,
        parents: 120,
      },
    },
    publicFirstHomeSavings: 600, // 공공 생애최초 저축액 (만원)

    regions: ['서울', '경기', '인천', '부산', '대구', '광주', '대전', '울산', '세종',
      '강원', '충북', '충남', '전북', '전남', '경북', '경남', '제주'],

    sources: [
      { name: '청약홈', url: 'https://www.applyhome.co.kr' },
      { name: '찾기쉬운 생활법령정보 · 특별공급 소득기준', url: 'https://easylaw.go.kr/CSP/CnpClsMain.laf?popMenu=ov&csmSeq=1773&ccfNo=3&cciNo=1&cnpClsNo=3' },
      { name: 'SH공사 · 2026 도시근로자 월평균소득', url: 'https://www.i-sh.co.kr/app/lay2/S48T1587C589/contents.do' },
      { name: '정책브리핑 · 민영주택 신생아 특별공급 신설', url: 'https://www.korea.kr/news/policyNewsView.do?newsId=148966536' },
    ],
  };

  if (typeof module === 'object' && module.exports) module.exports = RULES;
  else root.RULES = RULES;
})(typeof self !== 'undefined' ? self : this);
