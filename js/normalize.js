/*
 * scripts/normalize.py 의 normalize_ingredient_name()과 반드시 동일한 로직을 유지해야
 * drugs.json / dur_rules.json 의 ingredient_keys가 프론트에서도 그대로 맞아떨어진다.
 * 규칙을 바꿀 때는 두 파일을 함께 수정할 것.
 */
function normalizeIngredientName(raw) {
  if (!raw) return "";
  let name = raw.toLowerCase();
  name = name.replace(/\([^()]*\)/g, " ");
  name = name.replace(/\s+(?:as\s+[a-z0-9\- ]+\s*)?[\d.]+\s*(?:mg|g|mcg|ug|iu|%|ml)\b.*$/i, "");
  name = name.replace(/\s+/g, " ").trim();
  return name;
}
