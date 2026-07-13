// ai-arena — бэкенд на Cloudflare Worker.  (авто-деплой из гита: Cloudflare Workers Builds ← push в main)
// Держит твой ключ Anthropic (как секрет Cloudflare, НЕ в коде), зовёт Claude, отдаёт бой двух ИИ.
// Ключ вставляешь ТЫ в настройках воркера (Secret ANTHROPIC_API_KEY) — в коде его нет.
//
// Два режима:
//   обычный  — тема/ставка/бойцы приходят из витрины, Claude разыгрывает бой.
//   invent   — body.mode === "invent": Claude САМ придумывает тему, ставку и двух бойцов, потом бой.

const MODEL = "claude-opus-4-8";            // ← смени на "claude-haiku-4-5" для ~5× экономии (твои деньги, публичная витрина)
const MODEL_CORE = "claude-haiku-4-5";      // ← ядро-песочница (core.html): много ходов за прогон, потому дешёвая быстрая модель по умолчанию
const ALLOW_ORIGIN = "https://panarini.github.io"; // ← домен твоей витрины; "*" — разрешить всем

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": ALLOW_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return json({ error: "POST only" }, 405, cors);

    if (env.RATE_LIMITER) {
      const ip = request.headers.get("cf-connecting-ip") || "anon";
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return json({ error: "Слишком часто — подожди минуту." }, 429, cors);
    }
    if (!env.ANTHROPIC_API_KEY) return json({ error: "Ключ не настроен на сервере." }, 500, cors);

    let body;
    try { body = await request.json(); } catch { return json({ error: "bad json" }, 400, cors); }

    // Голое ядро (песочница движка двоих): один вызов = один ход одного агента. Изолировано от арены.
    if (body.mode === "core") return handleCore(body, env, cors);

    const clamp = (s, n) => String(s ?? "").slice(0, n);
    const rounds = Math.max(2, Math.min(5, parseInt(body.rounds, 10) || 3));
    const invent = body.mode === "invent";

    const roundItem = {
      type: "object", additionalProperties: false,
      properties: { a: { type: "string" }, b: { type: "string" }, win: { type: "string", enum: ["A", "B"] } },
      required: ["a", "b", "win"],
    };
    const fighter = {
      type: "object", additionalProperties: false,
      properties: { name: { type: "string" }, emoji: { type: "string" } },
      required: ["name", "emoji"],
    };

    const dir = "Ты — режиссёр риторического поединка двух ИИ-персонажей. Пиши на русском, остроумно и дерзко, но без токсичности, без оскорблений по признакам и без мата. Каждая реплика — одна-две фразы, в характере бойца, с эскалацией и подколами оппонента. Это зрелище, а не настоящий спор: ярко, смешно, по делу.";

    let schema, user;
    if (invent) {
      const DOMAINS = ["еда и напитки","бытовые привычки","гаджеты и техника","питомцы","спорт и фитнес","музыка и вкусы","одежда и стиль","путешествия и отпуск","работа и офис","утро и сон","соцсети и интернет","кино и сериалы","уборка и порядок","деньги и траты","праздники и подарки","транспорт и город","погода и сезоны","книги и чтение","видеоигры","соседи и этикет","суеверия и приметы","детство и ностальгия","дача и растения","кофе и чай","доставка и готовка","умный дом","мемы и интернет-культура","здоровый образ жизни","прокрастинация","споры о словах"];
      const domain = DOMAINS[Math.floor(Math.random() * DOMAINS.length)];
      user =
`Придумай ЗАБАВНЫЙ добродушный поединок и разыграй его сам.
Оттолкнись от области: «${domain}». Придумай в ней ОДНУ неожиданную, свежую, конкретную спорную мелочь
для дружеской словесной дуэли — каждый раз НОВУЮ, не банальную и не заезженную.
Тема безобидная: без политики, религии, насилия, трагедий и чувствительных тем.
Ещё придумай ставку (за что бьются) и двух КОНТРАСТНЫХ бойцов-персонажей — каждому короткое имя (1–2 слова) и один эмодзи.
Раундов: ${rounds}. В каждом раунде "a" — реплика первого бойца, "b" — ответ второго, "win" — кто выиграл раунд ("A"/"B").
Последний раунд — добивающие реплики. "reason" — фраза-вердикт судьи со ссылкой на тему или ставку.
Верни строго JSON по схеме.`;
      schema = {
        type: "object", additionalProperties: false,
        properties: {
          topic: { type: "string" }, stake: { type: "string" },
          a: fighter, b: fighter,
          rounds: { type: "array", items: roundItem },
          reason: { type: "string" },
        },
        required: ["topic", "stake", "a", "b", "rounds", "reason"],
      };
    } else {
      const topic = clamp(body.topic, 200) || "тёмная тема против светлой";
      const stake = clamp(body.stake, 200) || "право на последнее слово";
      const aName = clamp(body.aName, 40) || "Боец А";
      const bName = clamp(body.bName, 40) || "Боец Б";
      user =
`Тема схватки: «${topic}»
Ставка (за что бьются): «${stake}»
Красный угол: ${aName}
Синий угол: ${bName}
Раундов: ${rounds}

Разыграй бой: в каждом раунде ${aName} говорит реплику (поле "a"), затем ${bName} отвечает (поле "b"). Поле "win" — кто выиграл раунд по мнению судьи ("A" или "B"). Последний раунд — финишные добивающие реплики. В конце "reason" — одна фраза-вердикт судьи, ссылающаяся на тему или ставку. Верни строго JSON по схеме.`;
      schema = {
        type: "object", additionalProperties: false,
        properties: { rounds: { type: "array", items: roundItem }, reason: { type: "string" } },
        required: ["rounds", "reason"],
      };
    }

    const payload = {
      model: MODEL,
      max_tokens: 2000,
      system: dir,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema } },
    };

    let r;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(payload),
      });
    } catch {
      return json({ error: "Не достучался до Claude." }, 502, cors);
    }
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 300);
      return json({ error: "Claude вернул ошибку", status: r.status, detail }, 502, cors);
    }
    const data = await r.json();
    if (data.stop_reason === "refusal")
      return json({ error: "Модель отказалась от этой темы — попробуй другую." }, 200, cors);

    const text = (data.content || []).find((b) => b.type === "text")?.text || "";
    let fight;
    try { fight = JSON.parse(text); } catch { return json({ error: "Не разобрал ответ модели." }, 502, cors); }
    return json(fight, 200, cors);
  },
};

// ── Голое ядро: сгенерировать ОДИН ход одного агента. ──────────────────────────
// Ключевое свойство «разведённых воль»: агенту кладём только ЕГО тайное + общую
// сцену + публичную историю реплик. Тайное другого в его контекст не попадает.
async function handleCore(body, env, cors) {
  const clamp = (s, n) => String(s ?? "").slice(0, n);
  const a = body.a || {}, b = body.b || {};
  const me = body.turn === "B" ? "B" : "A";
  const meObj = me === "A" ? a : b;
  const shared = clamp(body.shared, 600);
  const name = clamp(meObj.name, 30) || me;
  const secret = clamp(meObj.secret, 400);
  const aName = clamp(a.name, 30) || "A";
  const bName = clamp(b.name, 30) || "B";
  const hist = Array.isArray(body.history) ? body.history.slice(-24) : [];

  const sys =
    `Ты — ${name}, живой участник сцены (не рассказчик). Общая сцена, её видят оба: ${shared || "(не задана)"}.` +
    (secret ? ` Только тебе известно (можешь не раскрывать напрямую): ${secret}.` : "") +
    ` Сейчас ТВОЙ ход. Ответь одной репликой или действием от первого лица — коротко (1–2 фразы), в моменте, живо. ` +
    `Без своего имени в начале, без кавычек и пояснений за кадром, сцену не пересказывай.`;

  let convo;
  if (!hist.length) {
    convo = `Разговор ещё не начинался. Сделай первый ход, ${name}.`;
  } else {
    const lines = hist.map((h) => `${h.who === "B" ? bName : aName}: ${clamp(h.text, 500)}`).join("\n");
    convo = `Что уже было сказано:\n${lines}\n\nТеперь твой ход, ${name}.`;
  }

  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL_CORE, max_tokens: 220, system: sys, messages: [{ role: "user", content: convo }] }),
    });
  } catch {
    return json({ error: "Не достучался до Claude." }, 502, cors);
  }
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 300);
    return json({ error: "Claude вернул ошибку", status: r.status, detail }, 502, cors);
  }
  const data = await r.json();
  if (data.stop_reason === "refusal")
    return json({ error: "Модель отказалась от этого хода — измени сцену." }, 200, cors);

  let text = ((data.content || []).find((x) => x.type === "text")?.text || "").trim();
  const px = new RegExp("^" + name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*[:—-]\\s*", "i");
  text = text.replace(px, "").trim();

  return json({ who: me, name, text }, 200, cors);
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...(cors || {}) },
  });
}
