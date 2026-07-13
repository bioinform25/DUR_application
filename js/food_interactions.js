/*
 * 흔한 음식-약물 상호작용 큐레이션 데이터.
 * DUR API에는 음식 상호작용이 없어 널리 알려진 사례를 직접 정리했다.
 * ingredient_keys는 scripts/normalize.py의 normalize_ingredient_name()과
 * 동일한 정규화 키를 써야 data/drugs.json의 ingredient_keys와 매칭된다.
 */
const FOOD_INTERACTIONS = [
  {
    id: "FOOD-GRAPEFRUIT",
    food: "자몽·자몽주스",
    ingredient_keys: [
      "simvastatin",
      "atorvastatin calcium",
      "atorvastatin calcium hydrate",
      "atorvastatin calcium trihydrate",
      "felodipine",
      "nifedipine",
      "amlodipine besylate",
      "lovastatin",
    ],
    description: "자몽(주스 포함)이 약물 대사효소(CYP3A4)를 억제해 혈중농도가 위험한 수준까지 올라갈 수 있습니다.",
    management: "이 약 복용 중에는 자몽 및 자몽주스 섭취를 피하세요.",
  },
  {
    id: "FOOD-DAIRY",
    food: "우유·유제품·칼슘보충제",
    ingredient_keys: [
      "ciprofloxacin",
      "ciprofloxacin hydrochloride",
      "tetracycline hydrochloride",
      "doxycycline hydrate",
      "doxycycline hyclate hydrate",
      "levofloxacin hydrate",
    ],
    description: "칼슘이 약물과 결합해 흡수를 방해하여 항생제 효과가 떨어질 수 있습니다.",
    management: "복용 전후 최소 1~2시간은 우유·유제품·칼슘보충제 섭취를 피하세요.",
  },
  {
    id: "FOOD-ALCOHOL",
    food: "알코올(술)",
    ingredient_keys: ["acetaminophen", "metronidazole", "zolpidem tartrate"],
    description: "간 손상 위험 증가, 과도한 진정작용 등 부작용이 커질 수 있습니다.",
    management: "이 약 복용 기간 중에는 음주를 피하세요.",
  },
  {
    id: "FOOD-VITAMIN-K",
    food: "비타민K가 많은 녹색채소(케일, 시금치, 브로콜리 등)",
    ingredient_keys: ["warfarin sodium"],
    description: "비타민K가 와파린의 항응고 효과를 약화시켜 약효가 떨어질 수 있습니다.",
    management: "채소 섭취량을 급격히 바꾸지 말고 평소 먹던 만큼 일정하게 유지하세요.",
  },
];
