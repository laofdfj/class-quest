import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const normalizeCode = (value: unknown) => String(value ?? "").trim().toUpperCase();
const normalizeName = (value: unknown) => String(value ?? "").trim().toLocaleLowerCase("ru-RU");

function snapshot(data: any, classItem: any, student: any) {
  return {
    class: { id: classItem.id, name: classItem.name },
    student,
    prizes: Array.isArray(data.prizes) ? data.prizes : [],
    settings: { budget: Number(data.settings?.budget ?? 1500) },
    ledger: (data.ledger ?? [])
      .filter((entry: any) => entry.studentId === student.id)
      .sort((a: any, b: any) => Date.parse(b.date) - Date.parse(a.date)),
    orders: (data.orders ?? [])
      .filter((order: any) => order.studentId === student.id)
      .sort((a: any, b: any) => Date.parse(b.date) - Date.parse(a.date)),
  };
}

async function findWorkspace(code: string) {
  const { data, error } = await admin
    .from("teacher_workspaces")
    .select("teacher_id,data,class_codes,updated_at")
    .contains("class_codes", [code])
    .limit(2);
  if (error) throw error;
  const row = (data ?? []).find((item: any) =>
    (item.data?.classes ?? []).some((c: any) => normalizeCode(c.code) === code)
  );
  if (!row) return null;
  return row;
}

async function handleStudentAction(body: any) {
  const code = normalizeCode(body.classCode);
  const name = normalizeName(body.name);
  if (!code || !name) {
    return { status: 400, body: { error: "Введите код класса и имя." } };
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await findWorkspace(code);
    if (!row) return { status: 404, body: { error: "Класс с таким кодом не найден." } };

    const data = structuredClone(row.data ?? {});
    const classItem = (data.classes ?? []).find((c: any) => normalizeCode(c.code) === code);
    if (!classItem) return { status: 404, body: { error: "Класс с таким кодом не найден." } };

    const student = (data.students ?? []).find((s: any) =>
      s.classId === classItem.id && normalizeName(s.name) === name
    );
    if (!student) return { status: 404, body: { error: "Ученик с таким именем не найден в этом классе." } };

    if (body.action === "purchase") {
      const prizeIndex = Number(body.prizeIndex);
      if (!Number.isInteger(prizeIndex) || prizeIndex < 0 || prizeIndex >= (data.prizes ?? []).length) {
        return { status: 400, body: { error: "Приз не найден." } };
      }
      const prize = data.prizes[prizeIndex];
      const price = Number(prize?.[3]);
      const cost = Number(prize?.[4]);
      const stock = Number(prize?.[5]);
      if (!prize || !Number.isFinite(price) || !Number.isFinite(cost)) {
        return { status: 400, body: { error: "Некорректные данные приза." } };
      }
      if (stock === 0) return { status: 409, body: { error: "Этот приз закончился." } };
      if (Number(student.balance ?? 0) < price) {
        return { status: 409, body: { error: "Пока не хватает XP." } };
      }
      const now = new Date();
      const spentThisMonth = (data.orders ?? [])
        .filter((o: any) => o.status !== "cancelled" &&
          new Date(o.date).getMonth() === now.getMonth() &&
          new Date(o.date).getFullYear() === now.getFullYear())
        .reduce((sum: number, o: any) => sum + Number(o.cost ?? 0), 0);
      if (spentThisMonth + cost > Number(data.settings?.budget ?? 1500)) {
        return { status: 409, body: { error: "Месячный бюджет исчерпан." } };
      }

      const date = now.toISOString();
      student.balance = Number(student.balance ?? 0) - price;
      if (stock > 0) prize[5] = stock - 1;
      data.orders = data.orders ?? [];
      data.ledger = data.ledger ?? [];
      data.orders.unshift({
        id: crypto.randomUUID(), studentId: student.id, studentName: student.name,
        name: prize[1], cost, price, prizeIndex, status: "pending", date,
      });
      data.ledger.unshift({
        id: crypto.randomUUID(), studentId: student.id, points: -price,
        reason: "Покупка: " + prize[1], date,
      });

      const { data: updated, error } = await admin
        .from("teacher_workspaces")
        .update({ data, updated_at: date })
        .eq("teacher_id", row.teacher_id)
        .eq("updated_at", row.updated_at)
        .select("teacher_id")
        .maybeSingle();
      if (error) throw error;
      if (!updated) continue;
      return { status: 200, body: { ok: true, ...snapshot(data, classItem, student) } };
    }

    return { status: 200, body: { ok: true, ...snapshot(data, classItem, student) } };
  }

  return { status: 409, body: { error: "Данные изменились одновременно. Обновите страницу и повторите." } };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  try {
    const body = await req.json();
    const result = await handleStudentAction(body);
    return new Response(JSON.stringify(result.body), {
      status: result.status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("student-portal error", error);
    return new Response(JSON.stringify({ error: "Не удалось выполнить запрос. Попробуйте ещё раз." }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
