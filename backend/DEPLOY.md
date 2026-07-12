# Как включить «живой ИИ» (слой 1)

Живому ИИ нужен бэкенд с **твоим** ключом Anthropic. Ключ вставляешь ты — я его не трогаю.
Всё делается в твоём аккаунте Cloudflare (бесплатный тариф хватает) за ~10 минут.

## 0. Ключ Anthropic
- Заведи ключ на **console.anthropic.com → API keys** (это твой аккаунт и твой счёт за API).
- Скопируй его. Больше нигде его не пиши — вставишь один раз в Cloudflare (шаг 3).

## Путь А — через дашборд (без терминала, проще)
1. **dash.cloudflare.com → Workers & Pages → Create → Worker.** Имя: `ai-arena-backend`. Deploy.
2. **Edit code** → вставь целиком содержимое [`worker.js`](worker.js) → **Deploy**.
3. **Settings → Variables and Secrets → Add** →
   - тип **Secret**, имя `ANTHROPIC_API_KEY`, значение = твой ключ → **Encrypt** → Save.
4. (Необязательно, но желательно для кошелька) добавь лимит: Settings → **Add binding → Rate limiting**,
   name `RATE_LIMITER`, limit `12`, period `60`. Если этого пункта нет в UI — пропусти, воркер работает и без него.
5. Скопируй URL воркера (вида `https://ai-arena-backend.<твой-логин>.workers.dev`).

## Путь Б — через терминал (wrangler)
```
npm i -g wrangler
cd ai-arena/backend
wrangler login
wrangler secret put ANTHROPIC_API_KEY   # вставишь ключ в ответ на приглашение
wrangler deploy
```
URL воркера напечатается в конце.

## Последний шаг — соединить витрину с воркером
В файле [`../arena.html`](../arena.html) найди строку:
```js
const BACKEND = "";
```
впиши туда URL воркера:
```js
const BACKEND = "https://ai-arena-backend.<твой-логин>.workers.dev";
```
Пересобери `index.html` и запушь — витрина оживёт (бойцы заговорят через Claude).
Скажи мне URL — и я сделаю этот шаг за тебя.

## Про деньги и защиту
- **Модель:** по умолчанию `claude-opus-4-8`. Для публичной витрины смени константу `MODEL` в `worker.js`
  на `claude-haiku-4-5` — примерно **в 5 раз дешевле** и быстрее (реплики короткие, разница в качестве для зрелища мелкая).
- **Лимит:** 12 боёв/мин с одного IP (шаг 4) плюс жёсткие ограничения в коде (раундов ≤ 5, короткий ответ) — это потолок расходов от чужих.
- **CORS:** воркер пускает только твой домен витрины (`ALLOW_ORIGIN`). Поменяй на `"*"`, если захочешь пускать всех.
