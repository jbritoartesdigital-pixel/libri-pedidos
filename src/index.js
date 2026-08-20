const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

const RSVP_TIME_ZONE = "America/Sao_Paulo";
const MEDIA_PUBLIC_BASE = "https://midia.libriconvites.com.br";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
const MAX_BULK_GUESTS = 300;

const IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

const VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/webm",
]);

const MEDIA_KINDS = new Set([
  "background_image",
  "background_video",
  "cover",
  "logo",
  "other",
]);

const DEFAULT_APPEARANCE = {
  background_color: "#f8efec",
  card_color: "#fffaf7",
  text_color: "#4f2d2a",
  muted_color: "#866e68",
  button_color: "#b8735f",
  button_text_color: "#ffffff",
  overlay_color: "#3a1f1b",
  overlay_opacity: 0.18,
  card_opacity: 0.94,
  card_blur: 12,
  card_radius: 28,
  font_style: "elegant",
  card_style: "glass",
  background_position: "center",
  background_x: "center",
  card_width: "medium",
  interface_language: "pt-BR",
  invitation_url: "",
  calendar_location: "",
  calendar_end_time: "",
  cover_url: "",
  logo_url: "",
};

const DEFAULT_PUBLIC_TEXTS = {
  eyebrow: "Confirmação de presença",
  intro: "Confirme sua presença para que tudo seja preparado com carinho.",
  lookup_label: "Digite seu nome",
  lookup_placeholder: "Comece a digitar seu nome",
  yes_button: "Sim, estarei presente!",
  no_button: "Não poderei comparecer",
  message_label: "Deixe uma mensagem carinhosa 💌",
  message_placeholder: "Uma mensagem especial para quem está celebrando...",
  success_title: "Presença confirmada!",
  success_message: "Que bom ter você com a gente. 💛",
  decline_title: "Resposta registrada",
  decline_message: "Obrigada por avisar.",
  decline_hint: "Tudo bem 💛 Se quiser, você ainda pode deixar uma mensagem carinhosa abaixo.",
  name_label: "Seu nome",
  calendar_button: "Adicionar à agenda",
  back_button: "Voltar ao convite",
  closed_title: "Confirmações encerradas",
};

const DEFAULT_PUBLIC_TEXTS_EN = {
  eyebrow: "RSVP",
  intro: "Please confirm your attendance so everything can be prepared with care.",
  lookup_label: "Enter your name",
  lookup_placeholder: "Start typing your name",
  yes_button: "Yes, I'll be there!",
  no_button: "I won't be able to attend",
  message_label: "Leave a sweet message 💌",
  message_placeholder: "A special message for the celebration...",
  success_title: "Attendance confirmed!",
  success_message: "We're so happy you'll be there. 💛",
  decline_title: "Response received",
  decline_message: "Thank you for letting us know.",
  decline_hint: "That's okay 💛 If you'd like, you can still leave a message below.",
  name_label: "Your name",
  calendar_button: "Add to calendar",
  back_button: "Back to invitation",
  closed_title: "RSVP closed",
};

const DEFAULT_CLIENT_PERMISSIONS = {
  manage_guests: true,
  manage_appearance: true,
  manage_texts: true,
  view_messages: true,
  export_guests: true,
  manage_event_details: false,
};

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);

      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, url);
      }

      return serveApp(request, env);
    } catch (error) {
      console.error(error);

      if (error instanceof HttpError) {
        return json({ error: error.message }, error.status);
      }

      return json({ error: "Ocorreu um erro interno." }, 500);
    }
  },
};

async function handleApi(request, env, url) {
  const method = request.method.toUpperCase();
  const path = url.pathname;

  // =======================================================
  // ADMIN AUTH
  // =======================================================

  if (path === "/api/admin/login" && method === "POST") {
    const body = await bodyJson(request);

    if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) {
      return json(
        { error: "ADMIN_PASSWORD e SESSION_SECRET não estão configurados." },
        500
      );
    }

    if (String(body.password || "") !== String(env.ADMIN_PASSWORD)) {
      return json({ error: "Senha incorreta." }, 401);
    }

    const cookie = await createAdminSession(env);

    return json({ ok: true }, 200, { "set-cookie": cookie });
  }

  if (path === "/api/admin/logout" && method === "POST") {
    return json(
      { ok: true },
      200,
      {
        "set-cookie":
          "libri_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
      }
    );
  }

  if (path === "/api/admin/me" && method === "GET") {
    if (!(await isAdmin(request, env))) {
      return json({ error: "Não autorizado." }, 401);
    }

    return json({ ok: true });
  }

  if (path.startsWith("/api/admin/")) {
    if (!(await isAdmin(request, env))) {
      return json({ error: "Sessão expirada. Entre novamente." }, 401);
    }
  }

  // =======================================================
  // ADMIN EVENTS
  // =======================================================

  if (path === "/api/admin/events" && method === "GET") {
    const archived = url.searchParams.get("archived") === "1";
    const events = await getEventsWithSummary(env, archived);
    return json({ events });
  }

  if (path === "/api/admin/events" && method === "POST") {
    const body = await bodyJson(request);

    if (!String(body.title || "").trim()) {
      return json({ error: "Informe o nome do evento." }, 400);
    }

    const event = await createEvent(env, body);

    await audit(env, {
      eventId: event.id,
      actorRole: "admin",
      action: "event_created",
      details: { title: event.title },
    });

    return json({ event });
  }

  let match = path.match(/^\/api\/admin\/events\/([^/]+)$/);

  if (match && method === "GET") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const origin = new URL(request.url).origin;

    return json({
      event: serializeEvent(event),
      summary: await getSummary(env, eventId),
      client_url: event.client_token
        ? `${origin}/cliente/${encodeURIComponent(event.client_token)}`
        : null,
      public_url: `${origin}/e/${encodeURIComponent(event.slug)}`,
    });
  }

  if (match && method === "PATCH") {
    const eventId = decodeURIComponent(match[1]);
    const current = await getEvent(env, eventId);

    if (!current) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const body = await bodyJson(request);
    const event = await updateEvent(env, current, body, "admin");

    await audit(env, {
      eventId,
      actorRole: "admin",
      action: "event_updated",
      details: { title: event.title },
    });

    return json({ event });
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/status$/);

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    if (event.archived_at) {
      return json(
        { error: "Restaure o evento antes de alterar o status." },
        400
      );
    }

    const body = await bodyJson(request);
    const status = body.status === "inactive" ? "inactive" : "active";

    await env.DB.prepare(`
      UPDATE events
      SET status = ?, updated_at = ?
      WHERE id = ?
    `)
      .bind(status, now(), eventId)
      .run();

    await audit(env, {
      eventId,
      actorRole: "admin",
      action: status === "active" ? "event_reactivated" : "event_paused",
    });

    return json({ event: serializeEvent(await getEvent(env, eventId)) });
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/archive$/);

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    if (!event.archived_at) {
      const archivedAt = now();

      await env.DB.prepare(`
        UPDATE events
        SET archived_at = ?, status = 'inactive', updated_at = ?
        WHERE id = ?
      `)
        .bind(archivedAt, archivedAt, eventId)
        .run();

      await audit(env, {
        eventId,
        actorRole: "admin",
        action: "event_archived",
      });
    }

    return json({ ok: true });
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/unarchive$/);

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    await env.DB.prepare(`
      UPDATE events
      SET archived_at = NULL, status = 'active', updated_at = ?
      WHERE id = ?
    `)
      .bind(now(), eventId)
      .run();

    await audit(env, {
      eventId,
      actorRole: "admin",
      action: "event_unarchived",
    });

    return json({ ok: true });
  }

  match = path.match(
    /^\/api\/admin\/events\/([^/]+)\/client-link\/reset$/
  );

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const token = randomToken();

    await env.DB.prepare(`
      UPDATE events
      SET client_token = ?, updated_at = ?
      WHERE id = ?
    `)
      .bind(token, now(), eventId)
      .run();

    await audit(env, {
      eventId,
      actorRole: "admin",
      action: "client_link_reset",
    });

    return json({
      client_url: `${new URL(request.url).origin}/cliente/${encodeURIComponent(
        token
      )}`,
    });
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/duplicate$/);

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);
    const current = await getEvent(env, eventId);

    if (!current) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const duplicated = await duplicateEvent(env, current);

    await audit(env, {
      eventId: duplicated.id,
      actorRole: "admin",
      action: "event_duplicated",
      details: {
        source_event_id: current.id,
        source_title: current.title,
      },
    });

    return json({ event: duplicated });
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/audit$/);

  if (match && method === "GET") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const limit = integerBetween(url.searchParams.get("limit") || 100, 1, 300);

    const result = await env.DB.prepare(`
      SELECT *
      FROM audit_logs
      WHERE event_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `)
      .bind(eventId, limit)
      .all();

    return json({ logs: result.results.map(serializeAudit) });
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/trash$/);

  if (match && method === "GET") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    return json({ guests: await listDeletedGuests(env, eventId) });
  }

  // =======================================================
  // ADMIN MEDIA
  // =======================================================

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/media$/);

  if (match && method === "GET") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    return json({ media: await listEventMedia(env, eventId) });
  }

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const media = await uploadEventMedia(request, env, event);

    await audit(env, {
      eventId,
      actorRole: "admin",
      action: "media_uploaded",
      details: { kind: media.media_kind, name: media.original_name },
    });

    return json({ media, event: serializeEvent(await getEvent(env, eventId)) });
  }

  match = path.match(
    /^\/api\/admin\/events\/([^/]+)\/media\/([^/]+)$/
  );

  if (match && method === "DELETE") {
    const eventId = decodeURIComponent(match[1]);
    const mediaId = decodeURIComponent(match[2]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const media = await deleteEventMedia(env, event, mediaId);

    await audit(env, {
      eventId,
      actorRole: "admin",
      action: "media_deleted",
      details: { kind: media.media_kind, name: media.original_name },
    });

    return json({ ok: true, event: serializeEvent(await getEvent(env, eventId)) });
  }

  // =======================================================
  // ADMIN GUESTS
  // =======================================================

  match = path.match(
    /^\/api\/admin\/events\/([^/]+)\/guests\/([^/]+)\/restore$/
  );

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);
    const guestId = decodeURIComponent(match[2]);
    const guest = await getDeletedGuestRow(env, eventId, guestId);

    if (!guest) {
      return json({ error: "Convidado excluído não encontrado." }, 404);
    }

    await restoreGuest(env, eventId, guestId);

    await audit(env, {
      eventId,
      guestId,
      actorRole: "admin",
      action: "guest_restored",
      details: { name: guest.primary_name },
    });

    return json({ guest: await getGuest(env, eventId, guestId) });
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/guests\/bulk$/);

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const body = await bodyJson(request);
    const result = await bulkCreateGuests(env, event, body.rows, "admin");

    await audit(env, {
      eventId,
      actorRole: "admin",
      action: "guest_bulk_imported",
      details: { created: result.created.length, failed: result.failed.length },
    });

    return json(result);
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/guests$/);

  if (match && method === "GET") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const [guests, counts] = await Promise.all([
      listGuests(env, eventId, url),
      guestStatusCounts(env, eventId),
    ]);

    return json({ guests, counts });
  }

  if (match && method === "POST") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const body = await bodyJson(request);
    const members = normalizeManagedMembers(body.members, body.response_status);
    const duplicateMatches = await findDuplicateMembers(env, eventId, members);
    const guest = await createGuest(env, event, body, "admin");

    await audit(env, {
      eventId,
      guestId: guest.id,
      actorRole: "admin",
      action: "guest_created",
      details: { name: guest.primary_name },
    });

    return json({ guest, duplicate_matches: duplicateMatches });
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/guests\/([^/]+)$/);

  if (match && method === "PATCH") {
    const eventId = decodeURIComponent(match[1]);
    const guestId = decodeURIComponent(match[2]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const existing = await getGuest(env, eventId, guestId);

    if (!existing) {
      return json({ error: "Convidado não encontrado." }, 404);
    }

    const body = await bodyJson(request);
    const members = body.members === undefined
      ? existing.members
      : normalizeManagedMembers(body.members, body.response_status ?? existing.response_status);

    const duplicateMatches = await findDuplicateMembers(
      env,
      eventId,
      members,
      guestId
    );

    const guest = await updateGuest(env, event, guestId, body);

    await audit(env, {
      eventId,
      guestId,
      actorRole: "admin",
      action: "guest_updated",
      details: { name: guest.primary_name },
    });

    return json({ guest, duplicate_matches: duplicateMatches });
  }

  if (match && method === "DELETE") {
    const eventId = decodeURIComponent(match[1]);
    const guestId = decodeURIComponent(match[2]);
    const guest = await getGuest(env, eventId, guestId);

    if (!guest) {
      return json({ error: "Convidado não encontrado." }, 404);
    }

    await softDeleteGuest(env, eventId, guestId);

    await audit(env, {
      eventId,
      guestId,
      actorRole: "admin",
      action: "guest_deleted",
      details: { name: guest.primary_name },
    });

    return json({ ok: true });
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/messages$/);

  if (match && method === "GET") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    return json({ messages: await listLoveMessages(env, eventId, url) });
  }

  match = path.match(/^\/api\/admin\/events\/([^/]+)\/export\.csv$/);

  if (match && method === "GET") {
    const eventId = decodeURIComponent(match[1]);
    const event = await getEvent(env, eventId);

    if (!event) {
      return json({ error: "Evento não encontrado." }, 404);
    }

    const language = normalizeAppearance(safeJson(event.appearance_settings, {})).interface_language;
    return csvResponse(
      await listGuestsRaw(env, eventId),
      `${language === "en" ? "guests" : "convidados"}-${event.slug}.csv`,
      language
    );
  }

  // =======================================================
  // CLIENT EVENT
  // =======================================================

  match = path.match(/^\/api\/client\/([^/]+)\/event$/);

  if (match && method === "GET") {
    const token = decodeURIComponent(match[1]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Este link não é válido ou foi substituído." }, 404);
    }

    return json({
      event: serializeEvent(event),
      summary: await getSummary(env, event.id),
    });
  }

  if (match && method === "PATCH") {
    const token = decodeURIComponent(match[1]);
    const current = await getEventByClientToken(env, token);

    if (!current) {
      return json({ error: "Acesso inválido." }, 404);
    }

    const body = await bodyJson(request);
    const event = await updateEventFromClient(env, current, body);

    await audit(env, {
      eventId: current.id,
      actorRole: "client",
      action: "event_updated",
      details: { title: event.title },
    });

    return json({ event });
  }

  // =======================================================
  // CLIENT MEDIA
  // =======================================================

  match = path.match(/^\/api\/client\/([^/]+)\/media$/);

  if (match && method === "GET") {
    const token = decodeURIComponent(match[1]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    return json({ media: await listEventMedia(env, event.id) });
  }

  if (match && method === "POST") {
    const token = decodeURIComponent(match[1]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    requireClientPermission(event, "manage_appearance");
    const media = await uploadEventMedia(request, env, event);

    await audit(env, {
      eventId: event.id,
      actorRole: "client",
      action: "media_uploaded",
      details: { kind: media.media_kind, name: media.original_name },
    });

    return json({ media, event: serializeEvent(await getEvent(env, event.id)) });
  }

  match = path.match(/^\/api\/client\/([^/]+)\/media\/([^/]+)$/);

  if (match && method === "DELETE") {
    const token = decodeURIComponent(match[1]);
    const mediaId = decodeURIComponent(match[2]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    requireClientPermission(event, "manage_appearance");
    const media = await deleteEventMedia(env, event, mediaId);

    await audit(env, {
      eventId: event.id,
      actorRole: "client",
      action: "media_deleted",
      details: { kind: media.media_kind, name: media.original_name },
    });

    return json({ ok: true, event: serializeEvent(await getEvent(env, event.id)) });
  }

  // =======================================================
  // CLIENT GUESTS
  // =======================================================

  match = path.match(/^\/api\/client\/([^/]+)\/guests\/bulk$/);

  if (match && method === "POST") {
    const token = decodeURIComponent(match[1]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    requireClientPermission(event, "manage_guests");
    const body = await bodyJson(request);
    const result = await bulkCreateGuests(env, event, body.rows, "client");

    await audit(env, {
      eventId: event.id,
      actorRole: "client",
      action: "guest_bulk_imported",
      details: { created: result.created.length, failed: result.failed.length },
    });

    return json(result);
  }

  match = path.match(/^\/api\/client\/([^/]+)\/guests$/);

  if (match && method === "GET") {
    const token = decodeURIComponent(match[1]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    const [guests, counts] = await Promise.all([
      listGuests(env, event.id, url),
      guestStatusCounts(env, event.id),
    ]);

    return json({ guests, counts });
  }

  if (match && method === "POST") {
    const token = decodeURIComponent(match[1]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    requireClientPermission(event, "manage_guests");
    const body = await bodyJson(request);
    const members = normalizeManagedMembers(body.members, body.response_status);
    const duplicateMatches = await findDuplicateMembers(env, event.id, members);
    const guest = await createGuest(env, event, body, "client");

    await audit(env, {
      eventId: event.id,
      guestId: guest.id,
      actorRole: "client",
      action: "guest_created",
      details: { name: guest.primary_name },
    });

    return json({ guest, duplicate_matches: duplicateMatches });
  }

  match = path.match(/^\/api\/client\/([^/]+)\/guests\/([^/]+)$/);

  if (match && method === "PATCH") {
    const token = decodeURIComponent(match[1]);
    const guestId = decodeURIComponent(match[2]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    requireClientPermission(event, "manage_guests");
    const existing = await getGuest(env, event.id, guestId);

    if (!existing) {
      return json({ error: "Convidado não encontrado." }, 404);
    }

    const body = await bodyJson(request);
    const members = body.members === undefined
      ? existing.members
      : normalizeManagedMembers(body.members, body.response_status ?? existing.response_status);

    const duplicateMatches = await findDuplicateMembers(
      env,
      event.id,
      members,
      guestId
    );

    const guest = await updateGuest(env, event, guestId, body);

    await audit(env, {
      eventId: event.id,
      guestId,
      actorRole: "client",
      action: "guest_updated",
      details: { name: guest.primary_name },
    });

    return json({ guest, duplicate_matches: duplicateMatches });
  }

  if (match && method === "DELETE") {
    const token = decodeURIComponent(match[1]);
    const guestId = decodeURIComponent(match[2]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    requireClientPermission(event, "manage_guests");
    const guest = await getGuest(env, event.id, guestId);

    if (!guest) {
      return json({ error: "Convidado não encontrado." }, 404);
    }

    await softDeleteGuest(env, event.id, guestId);

    await audit(env, {
      eventId: event.id,
      guestId,
      actorRole: "client",
      action: "guest_deleted",
      details: { name: guest.primary_name },
    });

    return json({ ok: true });
  }

  match = path.match(/^\/api\/client\/([^/]+)\/messages$/);

  if (match && method === "GET") {
    const token = decodeURIComponent(match[1]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    requireClientPermission(event, "view_messages");
    return json({ messages: await listLoveMessages(env, event.id, url) });
  }

  match = path.match(/^\/api\/client\/([^/]+)\/export\.csv$/);

  if (match && method === "GET") {
    const token = decodeURIComponent(match[1]);
    const event = await getEventByClientToken(env, token);

    if (!event) {
      return json({ error: "Acesso inválido." }, 404);
    }

    requireClientPermission(event, "export_guests");

    const language = normalizeAppearance(safeJson(event.appearance_settings, {})).interface_language;
    return csvResponse(
      await listGuestsRaw(env, event.id),
      `${language === "en" ? "guests" : "convidados"}-${event.slug}.csv`,
      language
    );
  }

  // =======================================================
  // PUBLIC EVENT
  // =======================================================

  match = path.match(/^\/api\/public\/events\/([^/]+)$/);

  if (match && method === "GET") {
    const slug = decodeURIComponent(match[1]);
    const event = await getEventBySlug(env, slug);

    if (!event) {
      return json({ error: "Esta confirmação não está disponível." }, 404);
    }

    return json({ event: publicEvent(event) });
  }

  match = path.match(/^\/api\/public\/events\/([^/]+)\/suggestions$/);

  if (match && method === "GET") {
    const slug = decodeURIComponent(match[1]);
    const event = await getEventBySlug(env, slug);

    if (!event) {
      return json({ error: "Evento indisponível." }, 404);
    }

    const availability = getRsvpAvailability(event);

    if (!availability.accepting) {
      return json({ error: availability.reason }, 403);
    }

    if (event.rsvp_mode !== "list") {
      return json({ suggestions: [] });
    }

    const q = normalizeName(url.searchParams.get("q") || "");

    if (q.length < 2) {
      return json({ suggestions: [] });
    }

    return json({ suggestions: await publicSuggestions(env, event.id, q) });
  }

  match = path.match(/^\/api\/public\/events\/([^/]+)\/lookup$/);

  if (match && method === "POST") {
    const slug = decodeURIComponent(match[1]);
    const event = await getEventBySlug(env, slug);

    if (!event) {
      return json({ error: "Evento indisponível." }, 404);
    }

    const availability = getRsvpAvailability(event);

    if (!availability.accepting) {
      return json({ error: availability.reason }, 403);
    }

    if (event.rsvp_mode !== "list") {
      return json({ error: "Este evento não utiliza lista pré-cadastrada." }, 400);
    }

    const body = await bodyJson(request);
    let guestRow = null;

    if (body.guest_id) {
      guestRow = await env.DB.prepare(`
        SELECT *
        FROM guests
        WHERE id = ? AND event_id = ? AND deleted_at IS NULL
        LIMIT 1
      `)
        .bind(String(body.guest_id), event.id)
        .first();
    } else {
      const normalized = normalizeName(body.name || "");

      if (!normalized) {
        return json({ error: "Digite seu nome." }, 400);
      }

      guestRow = await env.DB.prepare(`
        SELECT DISTINCT g.*
        FROM guests g
        LEFT JOIN guest_members gm
          ON gm.guest_id = g.id
          AND gm.deleted_at IS NULL
        WHERE
          g.event_id = ?
          AND g.deleted_at IS NULL
          AND (
            g.normalized_name = ?
            OR gm.normalized_name = ?
          )
        ORDER BY g.created_at ASC
        LIMIT 1
      `)
        .bind(event.id, normalized, normalized)
        .first();
    }

    if (!guestRow) {
      return json(
        {
          error:
            "Não encontramos esse nome na lista. Confira a escrita ou fale com o anfitrião.",
        },
        404
      );
    }

    const guest = await hydrateGuest(env, guestRow);
    return json({ guest: publicGuest(guest, event) });
  }

  match = path.match(/^\/api\/public\/events\/([^/]+)\/rsvp$/);

  if (match && method === "POST") {
    const slug = decodeURIComponent(match[1]);
    const event = await getEventBySlug(env, slug);

    if (!event) {
      return json({ error: "Evento indisponível." }, 404);
    }

    const availability = getRsvpAvailability(event);

    if (!availability.accepting) {
      return json({ error: availability.reason }, 403);
    }

    const body = await bodyJson(request);

    if (String(body.website || "").trim()) {
      return json({ ok: true });
    }

    let guest;

    if (event.rsvp_mode === "list") {
      if (!body.guest_id) {
        return json(
          { error: "Localize seu nome na lista antes de confirmar." },
          400
        );
      }

      guest = await submitListRsvp(env, event, body);
    } else {
      guest = await submitFreeRsvp(env, event, body);
    }

    await audit(env, {
      eventId: event.id,
      guestId: guest.id,
      actorRole: "public",
      action: "rsvp_submitted",
      details: {
        name: guest.primary_name,
        response_status: guest.response_status,
        confirmed_people: guest.confirmed_people,
      },
    });

    return json({ ok: true, guest: publicGuest(guest, event) });
  }

  return json({ error: "Rota não encontrada." }, 404);
}

// =========================================================
// EVENTS
// =========================================================

async function createEvent(env, body) {
  const id = crypto.randomUUID();
  const slug = await uniqueSlug(env, body.title);
  const clientToken = randomToken();
  const createdAt = now();

  const extraFields = normalizeExtraFields(body.extra_fields || {});
  const appearance = normalizeAppearance(body.appearance_settings || {});
  const publicTexts = normalizePublicTexts(body.public_texts || {}, appearance.interface_language);
  const clientPermissions = normalizeClientPermissions(body.client_permissions || {});
  const backgroundType = normalizeBackgroundType(body.background_type);
  const backgroundImageUrl = normalizeOptionalUrl(body.background_image_url);
  const backgroundVideoUrl = normalizeOptionalUrl(body.background_video_url);

  await env.DB.prepare(`
    INSERT INTO events (
      id,
      title,
      slug,
      event_date,
      event_time,
      rsvp_mode,
      welcome_message,
      primary_color,
      accent_color,
      background_image_url,
      extra_fields,
      client_token,
      status,
      rsvp_deadline,
      max_people_per_rsvp,
      archived_at,
      background_type,
      background_video_url,
      appearance_settings,
      public_texts,
      client_permissions,
      list_behavior,
      created_at,
      updated_at
    )
    VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, NULL,
      ?, ?, ?, ?, ?, ?, ?, ?
    )
  `)
    .bind(
      id,
      String(body.title).trim(),
      slug,
      cleanNullable(body.event_date),
      cleanNullable(body.event_time),
      body.rsvp_mode === "list" ? "list" : "free",
      cleanNullable(body.welcome_message),
      safeColor(body.primary_color, "#b8735f"),
      safeColor(body.accent_color, "#f8efec"),
      backgroundImageUrl,
      JSON.stringify(extraFields),
      clientToken,
      cleanNullable(body.rsvp_deadline),
      normalizeOptionalInteger(body.max_people_per_rsvp, 1, 100),
      backgroundType,
      backgroundVideoUrl,
      JSON.stringify(appearance),
      JSON.stringify(publicTexts),
      JSON.stringify(clientPermissions),
      normalizeListBehavior(body.list_behavior),
      createdAt,
      createdAt
    )
    .run();

  return serializeEvent(await getEvent(env, id));
}

async function updateEvent(env, current, body, actorRole = "admin") {
  const title = String(body.title ?? current.title).trim();

  if (!title) {
    throw new HttpError(400, "Informe o nome do evento.");
  }

  const extraFields = body.extra_fields !== undefined
    ? normalizeExtraFields(body.extra_fields)
    : normalizeExtraFields(safeJson(current.extra_fields, {}));

  const appearance = body.appearance_settings !== undefined
    ? normalizeAppearance(body.appearance_settings)
    : normalizeAppearance(safeJson(current.appearance_settings, {}));

  const publicTexts = body.public_texts !== undefined
    ? normalizePublicTexts(body.public_texts, appearance.interface_language)
    : normalizePublicTexts(safeJson(current.public_texts, {}), appearance.interface_language);

  const clientPermissions = body.client_permissions !== undefined
    ? normalizeClientPermissions(body.client_permissions)
    : normalizeClientPermissions(safeJson(current.client_permissions, {}));

  const rsvpMode = body.rsvp_mode === "list"
    ? "list"
    : body.rsvp_mode === "free"
      ? "free"
      : current.rsvp_mode;

  const backgroundImageUrl = normalizeOptionalUrl(
    body.background_image_url !== undefined
      ? body.background_image_url
      : current.background_image_url
  );

  const backgroundVideoUrl = normalizeOptionalUrl(
    body.background_video_url !== undefined
      ? body.background_video_url
      : current.background_video_url
  );

  await env.DB.prepare(`
    UPDATE events
    SET
      title = ?,
      event_date = ?,
      event_time = ?,
      rsvp_mode = ?,
      welcome_message = ?,
      primary_color = ?,
      accent_color = ?,
      background_image_url = ?,
      extra_fields = ?,
      rsvp_deadline = ?,
      max_people_per_rsvp = ?,
      background_type = ?,
      background_video_url = ?,
      appearance_settings = ?,
      public_texts = ?,
      client_permissions = ?,
      list_behavior = ?,
      updated_at = ?
    WHERE id = ?
  `)
    .bind(
      title,
      cleanNullable(body.event_date !== undefined ? body.event_date : current.event_date),
      cleanNullable(body.event_time !== undefined ? body.event_time : current.event_time),
      rsvpMode,
      cleanNullable(
        body.welcome_message !== undefined
          ? body.welcome_message
          : current.welcome_message
      ),
      safeColor(body.primary_color, current.primary_color || "#b8735f"),
      safeColor(body.accent_color, current.accent_color || "#f8efec"),
      backgroundImageUrl,
      JSON.stringify(extraFields),
      cleanNullable(
        body.rsvp_deadline !== undefined
          ? body.rsvp_deadline
          : current.rsvp_deadline
      ),
      normalizeOptionalInteger(
        body.max_people_per_rsvp !== undefined
          ? body.max_people_per_rsvp
          : current.max_people_per_rsvp,
        1,
        100
      ),
      normalizeBackgroundType(
        body.background_type !== undefined
          ? body.background_type
          : current.background_type
      ),
      backgroundVideoUrl,
      JSON.stringify(appearance),
      JSON.stringify(publicTexts),
      JSON.stringify(clientPermissions),
      normalizeListBehavior(
        body.list_behavior !== undefined
          ? body.list_behavior
          : current.list_behavior
      ),
      now(),
      current.id
    )
    .run();

  return serializeEvent(await getEvent(env, current.id));
}

async function updateEventFromClient(env, current, body) {
  const permissions = normalizeClientPermissions(
    safeJson(current.client_permissions, {})
  );

  const patch = {};

  if (body.appearance_settings !== undefined || body.background_type !== undefined) {
    if (!permissions.manage_appearance) {
      throw new HttpError(403, "A personalização visual está bloqueada para este evento.");
    }

    if (body.appearance_settings !== undefined) {
      patch.appearance_settings = body.appearance_settings;
    }

    if (body.background_type !== undefined) {
      patch.background_type = body.background_type;
    }
  }

  if (body.public_texts !== undefined) {
    if (!permissions.manage_texts) {
      throw new HttpError(403, "A edição dos textos está bloqueada para este evento.");
    }

    patch.public_texts = body.public_texts;
  }

  const detailKeys = [
    "event_date",
    "event_time",
    "welcome_message",
  ];

  const wantsDetails = detailKeys.some((key) => body[key] !== undefined);

  if (wantsDetails) {
    if (!permissions.manage_event_details) {
      throw new HttpError(403, "A edição dos dados do evento está bloqueada.");
    }

    for (const key of detailKeys) {
      if (body[key] !== undefined) {
        patch[key] = body[key];
      }
    }
  }

  if (!Object.keys(patch).length) {
    return serializeEvent(current);
  }

  return updateEvent(env, current, patch, "client");
}

async function duplicateEvent(env, current) {
  const copyTitle = `${current.title} • cópia`;

  return createEvent(env, {
    title: copyTitle,
    event_date: current.event_date,
    event_time: current.event_time,
    rsvp_mode: current.rsvp_mode,
    welcome_message: current.welcome_message,
    primary_color: current.primary_color,
    accent_color: current.accent_color,
    background_image_url: current.background_image_url,
    extra_fields: safeJson(current.extra_fields, {}),
    rsvp_deadline: current.rsvp_deadline,
    max_people_per_rsvp: current.max_people_per_rsvp,
    background_type: current.background_type,
    background_video_url: current.background_video_url,
    appearance_settings: safeJson(current.appearance_settings, {}),
    public_texts: safeJson(current.public_texts, {}),
    client_permissions: safeJson(current.client_permissions, {}),
    list_behavior: current.list_behavior,
  });
}

async function getEventsWithSummary(env, archived = false) {
  const result = await env.DB.prepare(`
    SELECT
      e.*,
      (
        SELECT COUNT(*)
        FROM guests g
        WHERE g.event_id = e.id
          AND g.deleted_at IS NULL
          AND g.response_status = 'yes'
      ) AS yes_responses,
      (
        SELECT COUNT(*)
        FROM guests g
        WHERE g.event_id = e.id
          AND g.deleted_at IS NULL
          AND g.response_status = 'no'
      ) AS no_responses,
      (
        SELECT COUNT(*)
        FROM guests g
        WHERE g.event_id = e.id
          AND g.deleted_at IS NULL
          AND g.response_status = 'pending'
      ) AS pending_responses,
      (
        SELECT COUNT(*)
        FROM guest_members gm
        INNER JOIN guests g ON g.id = gm.guest_id
        WHERE gm.event_id = e.id
          AND gm.deleted_at IS NULL
          AND g.deleted_at IS NULL
          AND gm.attendance_status = 'yes'
      ) AS people_confirmed,
      (
        SELECT COUNT(*)
        FROM guest_members gm
        INNER JOIN guests g ON g.id = gm.guest_id
        WHERE gm.event_id = e.id
          AND gm.deleted_at IS NULL
          AND g.deleted_at IS NULL
          AND gm.attendance_status = 'yes'
          AND gm.person_type = 'adult'
      ) AS adults_confirmed,
      (
        SELECT COUNT(*)
        FROM guest_members gm
        INNER JOIN guests g ON g.id = gm.guest_id
        WHERE gm.event_id = e.id
          AND gm.deleted_at IS NULL
          AND g.deleted_at IS NULL
          AND gm.attendance_status = 'yes'
          AND gm.person_type = 'child'
      ) AS children_confirmed
    FROM events e
    WHERE
      (? = 1 AND e.archived_at IS NOT NULL)
      OR
      (? = 0 AND e.archived_at IS NULL)
    ORDER BY
      CASE WHEN e.status = 'active' THEN 0 ELSE 1 END,
      COALESCE(e.event_date, '9999-12-31') ASC,
      e.created_at DESC
  `)
    .bind(archived ? 1 : 0, archived ? 1 : 0)
    .all();

  return result.results.map((row) => ({
    ...serializeEvent(row),
    yes_responses: Number(row.yes_responses || 0),
    no_responses: Number(row.no_responses || 0),
    pending_responses: Number(row.pending_responses || 0),
    people_confirmed: Number(row.people_confirmed || 0),
    adults_confirmed: Number(row.adults_confirmed || 0),
    children_confirmed: Number(row.children_confirmed || 0),
  }));
}

async function getEvent(env, id) {
  return env.DB.prepare(`
    SELECT * FROM events WHERE id = ? LIMIT 1
  `)
    .bind(id)
    .first();
}

async function getEventBySlug(env, slug) {
  return env.DB.prepare(`
    SELECT * FROM events WHERE slug = ? LIMIT 1
  `)
    .bind(slug)
    .first();
}

async function getEventByClientToken(env, token) {
  if (!token) return null;

  return env.DB.prepare(`
    SELECT * FROM events WHERE client_token = ? LIMIT 1
  `)
    .bind(token)
    .first();
}

async function getSummary(env, eventId) {
  const guestRow = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN response_status = 'yes' THEN 1 ELSE 0 END) AS yes_responses,
      SUM(CASE WHEN response_status = 'no' THEN 1 ELSE 0 END) AS no_responses,
      SUM(CASE WHEN response_status = 'pending' THEN 1 ELSE 0 END) AS pending_responses
    FROM guests
    WHERE event_id = ? AND deleted_at IS NULL
  `)
    .bind(eventId)
    .first();

  const memberRow = await env.DB.prepare(`
    SELECT
      SUM(CASE WHEN gm.attendance_status = 'yes' THEN 1 ELSE 0 END) AS people_confirmed,
      SUM(CASE WHEN gm.attendance_status = 'yes' AND gm.person_type = 'adult' THEN 1 ELSE 0 END) AS adults_confirmed,
      SUM(CASE WHEN gm.attendance_status = 'yes' AND gm.person_type = 'child' THEN 1 ELSE 0 END) AS children_confirmed,
      COUNT(*) AS people_registered
    FROM guest_members gm
    INNER JOIN guests g ON g.id = gm.guest_id
    WHERE gm.event_id = ?
      AND gm.deleted_at IS NULL
      AND g.deleted_at IS NULL
  `)
    .bind(eventId)
    .first();

  return {
    yes_responses: Number(guestRow?.yes_responses || 0),
    no_responses: Number(guestRow?.no_responses || 0),
    pending_responses: Number(guestRow?.pending_responses || 0),
    people_confirmed: Number(memberRow?.people_confirmed || 0),
    adults_confirmed: Number(memberRow?.adults_confirmed || 0),
    children_confirmed: Number(memberRow?.children_confirmed || 0),
    people_registered: Number(memberRow?.people_registered || 0),
  };
}

function getRsvpAvailability(event) {
  if (event.archived_at) {
    return {
      accepting: false,
      reason: "As confirmações deste evento estão encerradas.",
    };
  }

  if (event.status !== "active") {
    return {
      accepting: false,
      reason: "As confirmações estão temporariamente pausadas.",
    };
  }

  if (event.rsvp_deadline && hasDeadlinePassed(event.rsvp_deadline)) {
    return {
      accepting: false,
      reason: "O prazo para confirmação de presença foi encerrado.",
    };
  }

  return { accepting: true, reason: null };
}

// =========================================================
// MEDIA / R2
// =========================================================

async function listEventMedia(env, eventId) {
  const result = await env.DB.prepare(`
    SELECT *
    FROM event_media
    WHERE event_id = ? AND deleted_at IS NULL
    ORDER BY created_at DESC
  `)
    .bind(eventId)
    .all();

  return result.results.map(serializeMedia);
}

async function uploadEventMedia(request, env, event) {
  ensureMediaBinding(env);

  const contentType = request.headers.get("content-type") || "";

  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new HttpError(400, "Envie a mídia pelo campo de upload.");
  }

  const form = await request.formData();
  const file = form.get("file");
  const kind = normalizeMediaKind(form.get("kind"));

  if (!(file instanceof File)) {
    throw new HttpError(400, "Escolha um arquivo para enviar.");
  }

  validateMediaFile(file, kind);

  const objectKey = buildMediaObjectKey(event.id, kind, file.type);
  const publicUrl = publicUrlForKey(objectKey);
  const mediaId = crypto.randomUUID();
  const createdAt = now();

  await env.MEDIA.put(objectKey, file, {
    httpMetadata: {
      contentType: file.type,
      cacheControl: "public, max-age=31536000, immutable",
    },
    customMetadata: {
      eventId: event.id,
      mediaKind: kind,
      originalName: sanitizeMetadataText(file.name, 200),
    },
  });

  try {
    await env.DB.prepare(`
      INSERT INTO event_media (
        id,
        event_id,
        object_key,
        public_url,
        media_kind,
        mime_type,
        original_name,
        size_bytes,
        created_at,
        deleted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    `)
      .bind(
        mediaId,
        event.id,
        objectKey,
        publicUrl,
        kind,
        file.type,
        sanitizeMetadataText(file.name, 240),
        Number(file.size || 0),
        createdAt
      )
      .run();

    await applyMediaToEvent(env, event, kind, publicUrl);
  } catch (error) {
    await env.MEDIA.delete(objectKey).catch(() => {});
    throw error;
  }

  return serializeMedia(
    await env.DB.prepare(`
      SELECT * FROM event_media WHERE id = ? LIMIT 1
    `)
      .bind(mediaId)
      .first()
  );
}

async function deleteEventMedia(env, event, mediaId) {
  ensureMediaBinding(env);

  const media = await env.DB.prepare(`
    SELECT *
    FROM event_media
    WHERE id = ? AND event_id = ? AND deleted_at IS NULL
    LIMIT 1
  `)
    .bind(mediaId, event.id)
    .first();

  if (!media) {
    throw new HttpError(404, "Mídia não encontrada.");
  }

  await env.MEDIA.delete(media.object_key);

  const deletedAt = now();

  await env.DB.prepare(`
    UPDATE event_media
    SET deleted_at = ?
    WHERE id = ? AND event_id = ?
  `)
    .bind(deletedAt, mediaId, event.id)
    .run();

  await removeMediaFromEvent(env, event, media);

  return serializeMedia({ ...media, deleted_at: deletedAt });
}

async function applyMediaToEvent(env, event, kind, publicUrl) {
  if (kind === "background_image") {
    await env.DB.prepare(`
      UPDATE events
      SET background_image_url = ?, background_type = 'image', updated_at = ?
      WHERE id = ?
    `)
      .bind(publicUrl, now(), event.id)
      .run();

    return;
  }

  if (kind === "background_video") {
    await env.DB.prepare(`
      UPDATE events
      SET background_video_url = ?, background_type = 'video', updated_at = ?
      WHERE id = ?
    `)
      .bind(publicUrl, now(), event.id)
      .run();

    return;
  }

  if (kind === "cover" || kind === "logo") {
    const appearance = normalizeAppearance(safeJson(event.appearance_settings, {}));
    appearance[kind === "cover" ? "cover_url" : "logo_url"] = publicUrl;

    await env.DB.prepare(`
      UPDATE events
      SET appearance_settings = ?, updated_at = ?
      WHERE id = ?
    `)
      .bind(JSON.stringify(appearance), now(), event.id)
      .run();
  }
}

async function removeMediaFromEvent(env, event, media) {
  const latest = await getEvent(env, event.id);
  const appearance = normalizeAppearance(safeJson(latest.appearance_settings, {}));
  let changedAppearance = false;

  let backgroundImageUrl = latest.background_image_url;
  let backgroundVideoUrl = latest.background_video_url;
  let backgroundType = normalizeBackgroundType(latest.background_type);

  if (backgroundImageUrl === media.public_url) {
    backgroundImageUrl = null;
    if (backgroundType === "image") backgroundType = "none";
  }

  if (backgroundVideoUrl === media.public_url) {
    backgroundVideoUrl = null;
    if (backgroundType === "video") backgroundType = "none";
  }

  if (appearance.cover_url === media.public_url) {
    appearance.cover_url = "";
    changedAppearance = true;
  }

  if (appearance.logo_url === media.public_url) {
    appearance.logo_url = "";
    changedAppearance = true;
  }

  await env.DB.prepare(`
    UPDATE events
    SET
      background_image_url = ?,
      background_video_url = ?,
      background_type = ?,
      appearance_settings = ?,
      updated_at = ?
    WHERE id = ?
  `)
    .bind(
      backgroundImageUrl,
      backgroundVideoUrl,
      backgroundType,
      JSON.stringify(changedAppearance ? appearance : normalizeAppearance(safeJson(latest.appearance_settings, {}))),
      now(),
      event.id
    )
    .run();
}

function ensureMediaBinding(env) {
  if (!env.MEDIA) {
    throw new HttpError(500, "O armazenamento de mídia ainda não está conectado ao Worker.");
  }
}

function normalizeMediaKind(value) {
  const kind = String(value || "").trim();

  if (!MEDIA_KINDS.has(kind)) {
    throw new HttpError(400, "Tipo de mídia inválido.");
  }

  return kind;
}

function validateMediaFile(file, kind) {
  if (!file.size) {
    throw new HttpError(400, "O arquivo está vazio.");
  }

  if (kind === "background_video") {
    if (!VIDEO_MIME_TYPES.has(file.type)) {
      throw new HttpError(400, "Use vídeo MP4 ou WebM para o fundo.");
    }

    if (file.size > MAX_VIDEO_BYTES) {
      throw new HttpError(400, "O vídeo de fundo pode ter no máximo 20 MB.");
    }

    return;
  }

  if (kind === "background_image" || kind === "cover" || kind === "logo") {
    if (!IMAGE_MIME_TYPES.has(file.type)) {
      throw new HttpError(400, "Use imagem JPG, PNG, WebP ou AVIF.");
    }

    if (file.size > MAX_IMAGE_BYTES) {
      throw new HttpError(400, "A imagem pode ter no máximo 10 MB.");
    }

    return;
  }

  if (!IMAGE_MIME_TYPES.has(file.type) && !VIDEO_MIME_TYPES.has(file.type)) {
    throw new HttpError(400, "Formato de arquivo não permitido.");
  }

  if (file.size > MAX_VIDEO_BYTES) {
    throw new HttpError(400, "O arquivo pode ter no máximo 20 MB.");
  }
}

function buildMediaObjectKey(eventId, kind, mimeType) {
  const ext = extensionForMime(mimeType);
  const folder = kind.replace(/_/g, "-");
  const unique = `${Date.now()}-${crypto.randomUUID()}`;
  return `rsvp/${eventId}/${folder}/${unique}.${ext}`;
}

function extensionForMime(mimeType) {
  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/webm": "webm",
  };

  return map[mimeType] || "bin";
}

function publicUrlForKey(key) {
  return `${MEDIA_PUBLIC_BASE}/${key
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/")}`;
}

function serializeMedia(row) {
  if (!row) return null;

  return {
    id: row.id,
    event_id: row.event_id,
    public_url: row.public_url,
    media_kind: row.media_kind,
    mime_type: row.mime_type,
    original_name: row.original_name || "",
    size_bytes: Number(row.size_bytes || 0),
    created_at: row.created_at,
    deleted_at: row.deleted_at || null,
  };
}

// =========================================================
// GUEST LISTS
// =========================================================

async function listGuests(env, eventId, url) {
  const q = normalizeName(url.searchParams.get("q") || "");
  const status = url.searchParams.get("status") || "";

  let sql = `
    SELECT DISTINCT g.*
    FROM guests g
    LEFT JOIN guest_members gm
      ON gm.guest_id = g.id
      AND gm.deleted_at IS NULL
    WHERE g.event_id = ?
      AND g.deleted_at IS NULL
  `;

  const bindings = [eventId];

  if (q) {
    sql += `
      AND (
        g.normalized_name LIKE ?
        OR COALESCE(g.normalized_group_label, '') LIKE ?
        OR gm.normalized_name LIKE ?
      )
    `;

    bindings.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  if (["yes", "no", "pending"].includes(status)) {
    sql += ` AND g.response_status = ? `;
    bindings.push(status);
  }

  sql += `
    ORDER BY
      CASE
        WHEN g.responded_at IS NULL THEN 1
        ELSE 0
      END,
      g.responded_at DESC,
      g.updated_at DESC,
      COALESCE(NULLIF(g.group_label, ''), g.primary_name) COLLATE NOCASE ASC
  `;

  const result = await env.DB.prepare(sql).bind(...bindings).all();
  return hydrateGuests(env, result.results);
}


async function guestStatusCounts(env, eventId) {
  const row = await env.DB.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN response_status = 'yes' THEN 1 ELSE 0 END) AS yes_count,
      SUM(CASE WHEN response_status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN response_status = 'no' THEN 1 ELSE 0 END) AS no_count
    FROM guests
    WHERE event_id = ? AND deleted_at IS NULL
  `)
    .bind(eventId)
    .first();

  return {
    total: Number(row?.total || 0),
    yes: Number(row?.yes_count || 0),
    pending: Number(row?.pending_count || 0),
    no: Number(row?.no_count || 0),
  };
}

async function listGuestsRaw(env, eventId) {
  const result = await env.DB.prepare(`
    SELECT *
    FROM guests
    WHERE event_id = ? AND deleted_at IS NULL
    ORDER BY COALESCE(NULLIF(group_label, ''), primary_name) COLLATE NOCASE ASC
  `)
    .bind(eventId)
    .all();

  return hydrateGuests(env, result.results);
}

async function listDeletedGuests(env, eventId) {
  const result = await env.DB.prepare(`
    SELECT *
    FROM guests
    WHERE event_id = ? AND deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `)
    .bind(eventId)
    .all();

  return hydrateGuests(env, result.results, true);
}

async function getDeletedGuestRow(env, eventId, guestId) {
  return env.DB.prepare(`
    SELECT *
    FROM guests
    WHERE id = ? AND event_id = ? AND deleted_at IS NOT NULL
    LIMIT 1
  `)
    .bind(guestId, eventId)
    .first();
}

async function getGuest(env, eventId, guestId) {
  const row = await env.DB.prepare(`
    SELECT *
    FROM guests
    WHERE id = ? AND event_id = ? AND deleted_at IS NULL
    LIMIT 1
  `)
    .bind(guestId, eventId)
    .first();

  if (!row) return null;
  return hydrateGuest(env, row);
}

async function createGuest(env, event, body, source) {
  const primaryName = String(body.primary_name || "").trim();

  if (!primaryName) {
    throw new HttpError(400, "Informe o nome do responsável pela confirmação.");
  }

  if (primaryName.length > 150) {
    throw new HttpError(400, "O nome informado é muito longo.");
  }

  const id = crypto.randomUUID();
  const members = normalizeManagedMembers(body.members, body.response_status);
  const status = deriveGroupStatus(members, allowedStatus(body.response_status));
  const createdAt = now();
  const groupLabel = cleanOptionalText(body.group_label, 150);
  const maxPeopleAllowed = normalizeOptionalInteger(body.max_people_allowed, 1, 100);

  await env.DB.prepare(`
    INSERT INTO guests (
      id,
      event_id,
      primary_name,
      normalized_name,
      response_status,
      phone,
      adults,
      children,
      companions,
      dietary,
      notes,
      love_message,
      source,
      group_label,
      normalized_group_label,
      max_people_allowed,
      responded_at,
      created_at,
      updated_at,
      deleted_at
    )
    VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL
    )
  `)
    .bind(
      id,
      event.id,
      primaryName,
      normalizeName(primaryName),
      status,
      cleanOptionalText(body.phone, 80),
      countMembers(members, "adult"),
      countMembers(members, "child"),
      JSON.stringify(members.map((member) => member.name)),
      cleanOptionalText(body.dietary, 500),
      cleanOptionalText(body.notes, 2000),
      cleanOptionalText(body.love_message, 3000),
      source,
      groupLabel,
      normalizeName(groupLabel || ""),
      maxPeopleAllowed,
      status === "pending" ? null : createdAt,
      createdAt,
      createdAt
    )
    .run();

  await syncManagedGuestMembers(env, event.id, id, members, []);
  return getGuest(env, event.id, id);
}

async function updateGuest(env, event, guestId, body) {
  const existing = await getGuest(env, event.id, guestId);

  if (!existing) return null;

  const primaryName = String(body.primary_name ?? existing.primary_name).trim();

  if (!primaryName) {
    throw new HttpError(400, "Informe o nome do responsável pela confirmação.");
  }

  if (primaryName.length > 150) {
    throw new HttpError(400, "O nome informado é muito longo.");
  }

  const requestedStatus = body.response_status !== undefined
    ? allowedStatus(body.response_status)
    : existing.response_status;

  const shouldApplyFamilyStatus =
    body.members === undefined && ["yes", "no"].includes(requestedStatus);

  const members = body.members === undefined
    ? existing.members.map((member) => ({
        ...member,
        attendance_status: shouldApplyFamilyStatus
          ? requestedStatus
          : member.attendance_status,
      }))
    : normalizeManagedMembers(body.members, requestedStatus);

  const status = deriveGroupStatus(members, requestedStatus);

  const groupLabel = body.group_label !== undefined
    ? cleanOptionalText(body.group_label, 150)
    : existing.group_label || null;

  const maxPeopleAllowed = body.max_people_allowed !== undefined
    ? normalizeOptionalInteger(body.max_people_allowed, 1, 100)
    : existing.max_people_allowed;

  await env.DB.prepare(`
    UPDATE guests
    SET
      primary_name = ?,
      normalized_name = ?,
      response_status = ?,
      phone = ?,
      adults = ?,
      children = ?,
      companions = ?,
      dietary = ?,
      notes = ?,
      love_message = ?,
      group_label = ?,
      normalized_group_label = ?,
      max_people_allowed = ?,
      responded_at = ?,
      updated_at = ?
    WHERE id = ? AND event_id = ? AND deleted_at IS NULL
  `)
    .bind(
      primaryName,
      normalizeName(primaryName),
      status,
      cleanOptionalText(
        body.phone !== undefined ? body.phone : existing.phone,
        80
      ),
      countMembers(members, "adult"),
      countMembers(members, "child"),
      JSON.stringify(members.map((member) => member.name)),
      cleanOptionalText(
        body.dietary !== undefined ? body.dietary : existing.dietary,
        500
      ),
      cleanOptionalText(
        body.notes !== undefined ? body.notes : existing.notes,
        2000
      ),
      cleanOptionalText(
        body.love_message !== undefined ? body.love_message : existing.love_message,
        3000
      ),
      groupLabel,
      normalizeName(groupLabel || ""),
      maxPeopleAllowed,
      status === "pending" ? existing.responded_at || null : existing.responded_at || now(),
      now(),
      guestId,
      event.id
    )
    .run();

  if (body.members !== undefined || shouldApplyFamilyStatus) {
    await syncManagedGuestMembers(env, event.id, guestId, members, existing.members);
  }

  return getGuest(env, event.id, guestId);
}

async function syncManagedGuestMembers(env, eventId, guestId, members, existingMembers) {
  const currentTime = now();
  const existingById = new Map(
    (existingMembers || []).filter((member) => member.id).map((member) => [member.id, member])
  );
  const keepIds = new Set();
  const statements = [];

  members.forEach((member, index) => {
    const existing = member.id ? existingById.get(member.id) : null;

    if (existing) {
      keepIds.add(existing.id);

      statements.push(
        env.DB.prepare(`
          UPDATE guest_members
          SET
            name = ?,
            normalized_name = ?,
            person_type = ?,
            attendance_status = ?,
            is_primary = ?,
            sort_order = ?,
            updated_at = ?,
            deleted_at = NULL
          WHERE id = ? AND guest_id = ? AND event_id = ?
        `).bind(
          member.name,
          normalizeName(member.name),
          member.person_type,
          member.attendance_status,
          index === 0 ? 1 : 0,
          index,
          currentTime,
          existing.id,
          guestId,
          eventId
        )
      );
    } else {
      const id = crypto.randomUUID();
      keepIds.add(id);

      statements.push(
        env.DB.prepare(`
          INSERT INTO guest_members (
            id,
            guest_id,
            event_id,
            name,
            normalized_name,
            person_type,
            is_primary,
            sort_order,
            created_at,
            updated_at,
            deleted_at,
            attendance_status,
            is_preapproved
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 1)
        `).bind(
          id,
          guestId,
          eventId,
          member.name,
          normalizeName(member.name),
          member.person_type,
          index === 0 ? 1 : 0,
          index,
          currentTime,
          currentTime,
          member.attendance_status
        )
      );
    }
  });

  for (const existing of existingMembers || []) {
    if (existing.id && !keepIds.has(existing.id)) {
      statements.push(
        env.DB.prepare(`
          UPDATE guest_members
          SET deleted_at = ?, updated_at = ?
          WHERE id = ? AND guest_id = ? AND event_id = ? AND deleted_at IS NULL
        `).bind(currentTime, currentTime, existing.id, guestId, eventId)
      );
    }
  }

  if (statements.length) {
    await env.DB.batch(statements);
  }
}

async function bulkCreateGuests(env, event, rows, source) {
  if (!Array.isArray(rows) || !rows.length) {
    throw new HttpError(400, "Envie pelo menos um convidado para importar.");
  }

  if (rows.length > MAX_BULK_GUESTS) {
    throw new HttpError(
      400,
      `Importe no máximo ${MAX_BULK_GUESTS} confirmações por vez.`
    );
  }

  const created = [];
  const failed = [];

  for (let index = 0; index < rows.length; index++) {
    try {
      const guest = await createGuest(env, event, rows[index] || {}, source);
      created.push(guest);
    } catch (error) {
      failed.push({
        index,
        name: String(rows[index]?.primary_name || "").trim(),
        error: error instanceof Error ? error.message : "Falha ao importar.",
      });
    }
  }

  return { created, failed };
}

async function softDeleteGuest(env, eventId, guestId) {
  const currentTime = now();

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE guests
      SET deleted_at = ?, updated_at = ?
      WHERE id = ? AND event_id = ? AND deleted_at IS NULL
    `).bind(currentTime, currentTime, guestId, eventId),

    env.DB.prepare(`
      UPDATE guest_members
      SET deleted_at = ?, updated_at = ?
      WHERE guest_id = ? AND event_id = ? AND deleted_at IS NULL
    `).bind(currentTime, currentTime, guestId, eventId),
  ]);
}

async function restoreGuest(env, eventId, guestId) {
  const currentTime = now();

  await env.DB.batch([
    env.DB.prepare(`
      UPDATE guests
      SET deleted_at = NULL, updated_at = ?
      WHERE id = ? AND event_id = ?
    `).bind(currentTime, guestId, eventId),

    env.DB.prepare(`
      UPDATE guest_members
      SET deleted_at = NULL, updated_at = ?
      WHERE guest_id = ? AND event_id = ?
    `).bind(currentTime, guestId, eventId),
  ]);
}

async function hydrateGuests(env, rows, includeDeleted = false) {
  if (!rows.length) return [];

  const guestIds = rows.map((row) => row.id);
  const placeholders = guestIds.map(() => "?").join(",");

  const result = await env.DB.prepare(`
    SELECT *
    FROM guest_members
    WHERE guest_id IN (${placeholders})
    ${includeDeleted ? "" : "AND deleted_at IS NULL"}
    ORDER BY sort_order ASC, name COLLATE NOCASE ASC
  `)
    .bind(...guestIds)
    .all();

  const map = new Map();

  for (const member of result.results) {
    if (!map.has(member.guest_id)) {
      map.set(member.guest_id, []);
    }

    map.get(member.guest_id).push(serializeMember(member));
  }

  return rows.map((row) => serializeGuestRow(row, map.get(row.id) || []));
}

async function hydrateGuest(env, row) {
  const result = await env.DB.prepare(`
    SELECT *
    FROM guest_members
    WHERE guest_id = ? AND deleted_at IS NULL
    ORDER BY sort_order ASC, name COLLATE NOCASE ASC
  `)
    .bind(row.id)
    .all();

  return serializeGuestRow(row, result.results.map(serializeMember));
}

async function findDuplicateMembers(env, eventId, members, excludeGuestId = null) {
  const normalizedNames = [
    ...new Set(
      (members || [])
        .map((member) => normalizeName(member.name))
        .filter(Boolean)
    ),
  ];

  if (!normalizedNames.length) return [];

  const placeholders = normalizedNames.map(() => "?").join(",");

  let sql = `
    SELECT
      gm.name,
      gm.normalized_name,
      gm.guest_id,
      g.primary_name,
      g.group_label
    FROM guest_members gm
    INNER JOIN guests g ON g.id = gm.guest_id
    WHERE gm.event_id = ?
      AND gm.deleted_at IS NULL
      AND g.deleted_at IS NULL
      AND gm.normalized_name IN (${placeholders})
  `;

  const bindings = [eventId, ...normalizedNames];

  if (excludeGuestId) {
    sql += ` AND gm.guest_id != ? `;
    bindings.push(excludeGuestId);
  }

  const result = await env.DB.prepare(sql).bind(...bindings).all();

  return result.results.map((row) => ({
    name: row.name,
    guest_id: row.guest_id,
    confirmation_name: row.group_label || row.primary_name,
  }));
}

async function listLoveMessages(env, eventId, url) {
  const q = normalizeName(url.searchParams.get("q") || "");

  let sql = `
    SELECT
      id,
      primary_name,
      group_label,
      love_message,
      response_status,
      responded_at,
      updated_at
    FROM guests
    WHERE event_id = ?
      AND deleted_at IS NULL
      AND love_message IS NOT NULL
      AND trim(love_message) <> ''
  `;

  const bindings = [eventId];

  if (q) {
    sql += `
      AND (
        normalized_name LIKE ?
        OR COALESCE(normalized_group_label, '') LIKE ?
      )
    `;
    bindings.push(`%${q}%`, `%${q}%`);
  }

  sql += ` ORDER BY COALESCE(responded_at, updated_at) DESC `;

  const result = await env.DB.prepare(sql).bind(...bindings).all();

  return result.results.map((row) => ({
    guest_id: row.id,
    name: row.group_label || row.primary_name,
    primary_name: row.primary_name,
    message: row.love_message,
    response_status: row.response_status,
    responded_at: row.responded_at || row.updated_at,
  }));
}

// =========================================================
// PUBLIC LIST SEARCH
// =========================================================

async function publicSuggestions(env, eventId, q) {
  const contains = `%${q}%`;
  const prefix = `${q}%`;

  const result = await env.DB.prepare(`
    SELECT
      gm.id AS member_id,
      gm.guest_id,
      gm.name,
      gm.normalized_name,
      gm.person_type,
      g.group_label,
      g.primary_name
    FROM guest_members gm
    INNER JOIN guests g ON g.id = gm.guest_id
    WHERE gm.event_id = ?
      AND gm.deleted_at IS NULL
      AND g.deleted_at IS NULL
      AND gm.normalized_name LIKE ?
    ORDER BY
      CASE WHEN gm.normalized_name LIKE ? THEN 0 ELSE 1 END,
      gm.name COLLATE NOCASE ASC
    LIMIT 5
  `)
    .bind(eventId, contains, prefix)
    .all();

  return result.results.map((row) => ({
    guest_id: row.guest_id,
    member_id: row.member_id,
    display_name: maskPublicName(row.name),
    person_type: row.person_type === "child" ? "child" : "adult",
  }));
}

function publicGuest(guest, event) {
  return {
    id: guest.id,
    primary_name: guest.primary_name,
    group_label: guest.group_label,
    response_status: guest.response_status,
    max_people_allowed: guest.max_people_allowed,
    effective_limit: effectiveGuestLimit(event, guest),
    list_behavior: normalizeListBehavior(event.list_behavior),
    members: guest.members.map((member) => ({
      id: member.id,
      name: member.name,
      person_type: member.person_type,
      attendance_status: member.attendance_status,
      is_preapproved: member.is_preapproved,
    })),
  };
}

function maskPublicName(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (!parts.length) return "Convidado";
  if (parts.length === 1) return parts[0];

  return `${parts[0]} ${parts
    .slice(1)
    .map((part) => `${part.charAt(0).toUpperCase()}.`)
    .join(" ")}`;
}

// =========================================================
// PUBLIC RSVP
// =========================================================

async function submitListRsvp(env, event, body) {
  const existing = await getGuest(env, event.id, String(body.guest_id));

  if (!existing) {
    throw new HttpError(404, "Convidado não encontrado neste evento.");
  }

  const listBehavior = normalizeListBehavior(event.list_behavior);
  const responseMap = new Map();

  if (Array.isArray(body.member_responses)) {
    for (const item of body.member_responses) {
      const id = String(item?.id || "").trim();
      if (!id) continue;
      responseMap.set(id, normalizeAttendanceStatus(item?.attendance_status));
    }
  }

  const familyFallback = ["yes", "no"].includes(body.response_status)
    ? body.response_status
    : null;

  const removeIds = new Set(
    Array.isArray(body.remove_member_ids)
      ? body.remove_member_ids.map((id) => String(id))
      : []
  );

  const projectedExisting = [];

  for (const member of existing.members) {
    if (removeIds.has(member.id)) {
      if (member.is_preapproved || listBehavior === "strict") {
        throw new HttpError(
          400,
          "Pessoas pré-cadastradas não podem ser removidas pelo convite."
        );
      }

      continue;
    }

    projectedExisting.push({
      ...member,
      attendance_status: responseMap.has(member.id)
        ? responseMap.get(member.id)
        : familyFallback
          ? familyFallback
          : member.attendance_status,
    });
  }

  const newMembers = listBehavior === "flexible"
    ? normalizePublicNewMembers(body.new_members)
    : [];

  if (
    listBehavior === "strict" &&
    Array.isArray(body.new_members) &&
    body.new_members.length
  ) {
    throw new HttpError(
      400,
      "Este convite permite confirmar apenas as pessoas já cadastradas."
    );
  }

  const localNames = new Set(
    projectedExisting.map((member) => normalizeName(member.name)).filter(Boolean)
  );

  for (const member of newMembers) {
    const normalized = normalizeName(member.name);

    if (localNames.has(normalized)) {
      throw new HttpError(
        400,
        `${member.name} já está nesta confirmação.`
      );
    }

    localNames.add(normalized);
  }

  if (newMembers.length) {
    const duplicates = await findDuplicateMembers(
      env,
      event.id,
      newMembers,
      existing.id
    );

    if (duplicates.length) {
      throw new HttpError(
        400,
        `${duplicates[0].name} já consta em outra confirmação deste evento.`
      );
    }
  }

  const projectedMembers = [...projectedExisting, ...newMembers];
  const limit = effectiveGuestLimit(event, existing);
  const confirmedCount = projectedMembers.filter(
    (member) => member.attendance_status === "yes"
  ).length;

  if (listBehavior === "flexible" && limit && confirmedCount > limit) {
    throw new HttpError(
      400,
      `Esta confirmação permite no máximo ${limit} pessoa(s) presentes.`
    );
  }

  const currentTime = now();
  const statements = [];

  for (const member of existing.members) {
    if (removeIds.has(member.id)) {
      statements.push(
        env.DB.prepare(`
          UPDATE guest_members
          SET deleted_at = ?, updated_at = ?
          WHERE id = ? AND guest_id = ? AND event_id = ?
        `).bind(currentTime, currentTime, member.id, existing.id, event.id)
      );

      continue;
    }

    const projected = projectedExisting.find((item) => item.id === member.id);

    statements.push(
      env.DB.prepare(`
        UPDATE guest_members
        SET attendance_status = ?, updated_at = ?
        WHERE id = ? AND guest_id = ? AND event_id = ? AND deleted_at IS NULL
      `).bind(
        projected?.attendance_status || member.attendance_status,
        currentTime,
        member.id,
        existing.id,
        event.id
      )
    );
  }

  let sortOrder = existing.members.length;

  for (const member of newMembers) {
    statements.push(
      env.DB.prepare(`
        INSERT INTO guest_members (
          id,
          guest_id,
          event_id,
          name,
          normalized_name,
          person_type,
          is_primary,
          sort_order,
          created_at,
          updated_at,
          deleted_at,
          attendance_status,
          is_preapproved
        )
        VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, NULL, ?, 0)
      `).bind(
        crypto.randomUUID(),
        existing.id,
        event.id,
        member.name,
        normalizeName(member.name),
        member.person_type,
        sortOrder++,
        currentTime,
        currentTime,
        member.attendance_status
      )
    );
  }

  if (statements.length) {
    await env.DB.batch(statements);
  }

  const groupStatus = deriveGroupStatus(
    projectedMembers,
    familyFallback || existing.response_status
  );

  await env.DB.prepare(`
    UPDATE guests
    SET
      response_status = ?,
      phone = ?,
      dietary = ?,
      notes = ?,
      love_message = ?,
      adults = ?,
      children = ?,
      companions = ?,
      responded_at = ?,
      updated_at = ?
    WHERE id = ? AND event_id = ? AND deleted_at IS NULL
  `)
    .bind(
      groupStatus,
      cleanOptionalText(body.phone !== undefined ? body.phone : existing.phone, 80),
      cleanOptionalText(body.dietary !== undefined ? body.dietary : existing.dietary, 500),
      cleanOptionalText(body.notes !== undefined ? body.notes : existing.notes, 2000),
      cleanOptionalText(
        body.love_message !== undefined ? body.love_message : existing.love_message,
        3000
      ),
      countMembers(projectedMembers, "adult"),
      countMembers(projectedMembers, "child"),
      JSON.stringify(projectedMembers.map((member) => member.name)),
      currentTime,
      currentTime,
      existing.id,
      event.id
    )
    .run();

  return getGuest(env, event.id, existing.id);
}

async function submitFreeRsvp(env, event, body) {
  const primaryName = String(body.primary_name || "").trim();

  if (!primaryName) {
    throw new HttpError(400, "Informe seu nome.");
  }

  const responseStatus = allowedPublicResponse(body.response_status);
  const normalized = normalizeName(primaryName);

  const existingRow = await env.DB.prepare(`
    SELECT *
    FROM guests
    WHERE event_id = ?
      AND normalized_name = ?
      AND deleted_at IS NULL
    ORDER BY created_at ASC
    LIMIT 1
  `)
    .bind(event.id, normalized)
    .first();

  const existing = existingRow ? await hydrateGuest(env, existingRow) : null;

  let members;

  if (responseStatus === "yes") {
    members = normalizePublicFreeMembers(body.members);

    if (!members.length) {
      throw new HttpError(400, "Informe pelo menos uma pessoa que irá à festa.");
    }

    const limit = Number(event.max_people_per_rsvp || 0) || null;

    if (limit && members.length > limit) {
      throw new HttpError(
        400,
        `Esta confirmação permite no máximo ${limit} pessoa(s).`
      );
    }
  } else {
    members = existing?.members?.length
      ? existing.members.map((member) => ({
          id: member.id,
          name: member.name,
          person_type: member.person_type,
          attendance_status: "no",
          is_preapproved: member.is_preapproved,
        }))
      : [];
  }

  const payload = {
    ...body,
    primary_name: primaryName,
    response_status: responseStatus,
    members,
  };

  let guest;

  if (existing) {
    guest = await updateGuest(env, event, existing.id, payload);
  } else {
    guest = await createGuest(env, event, payload, "public");
  }

  await env.DB.prepare(`
    UPDATE guests
    SET responded_at = ?, updated_at = ?
    WHERE id = ? AND event_id = ?
  `)
    .bind(now(), now(), guest.id, event.id)
    .run();

  return getGuest(env, event.id, guest.id);
}

function normalizePublicNewMembers(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      name: String(item?.name || "").trim().slice(0, 150),
      person_type: item?.person_type === "child" ? "child" : "adult",
      attendance_status: normalizeAttendanceStatus(item?.attendance_status || "yes"),
    }))
    .filter((item) => item.name)
    .slice(0, 100);
}

function normalizePublicFreeMembers(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => ({
      id: item?.id ? String(item.id) : undefined,
      name: String(item?.name || "").trim().slice(0, 150),
      person_type: item?.person_type === "child" ? "child" : "adult",
      attendance_status: "yes",
      is_preapproved: Boolean(item?.is_preapproved),
    }))
    .filter((item) => item.name)
    .slice(0, 100);
}

function effectiveGuestLimit(event, guest) {
  const guestLimit = Number(guest?.max_people_allowed || 0);
  if (guestLimit > 0) return guestLimit;

  const eventLimit = Number(event?.max_people_per_rsvp || 0);
  return eventLimit > 0 ? eventLimit : null;
}

// =========================================================
// AUDIT
// =========================================================

async function audit(
  env,
  { eventId, guestId = null, actorRole, action, details = null }
) {
  try {
    await env.DB.prepare(`
      INSERT INTO audit_logs (
        id,
        event_id,
        guest_id,
        actor_role,
        action,
        details,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        crypto.randomUUID(),
        eventId,
        guestId,
        actorRole,
        action,
        details ? JSON.stringify(details) : null,
        now()
      )
      .run();
  } catch (error) {
    console.error("Falha ao registrar auditoria:", error);
  }
}

// =========================================================
// ADMIN SESSION
// =========================================================

async function createAdminSession(env) {
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
  const payload = `admin.${expires}`;
  const signature = await sign(payload, env.SESSION_SECRET);
  const token = `${payload}.${signature}`;

  return [
    `libri_admin=${token}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    "Max-Age=86400",
  ].join("; ");
}

async function isAdmin(request, env) {
  if (!env.SESSION_SECRET) return false;

  const cookies = parseCookies(request.headers.get("cookie") || "");
  const token = cookies.libri_admin;

  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  const role = parts[0];
  const expires = Number(parts[1]);
  const signature = parts[2];

  if (
    role !== "admin" ||
    !Number.isFinite(expires) ||
    expires < Math.floor(Date.now() / 1000)
  ) {
    return false;
  }

  const expected = await sign(`${role}.${expires}`, env.SESSION_SECRET);
  return safeEqual(signature, expected);
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );

  return base64Url(new Uint8Array(signature));
}

// =========================================================
// CSV
// =========================================================

function csvResponse(guests, filename, language = "pt-BR") {
  const en = language === "en";
  const rows = [
    en
      ? ["Primary contact","Family / group","Status","Confirmed people","Adults","Children","Limit","Phone","Dietary restrictions","Notes","Sweet message","Source","Responded at"]
      : ["Responsável","Família / grupo","Status","Pessoas confirmadas","Adultos","Crianças","Limite","Telefone","Restrição alimentar","Observações","Mensagem carinhosa","Origem","Respondido em"],
  ];

  for (const guest of guests) {
    const adults = guest.members
      .filter((member) => member.person_type === "adult")
      .map((member) => `${member.name} (${attendanceLabel(member.attendance_status, language)})`)
      .join(" | ");

    const children = guest.members
      .filter((member) => member.person_type === "child")
      .map((member) => `${member.name} (${attendanceLabel(member.attendance_status, language)})`)
      .join(" | ");

    rows.push([
      guest.primary_name,
      guest.group_label || "",
      statusLabelText(guest.response_status, language),
      guest.confirmed_people,
      adults,
      children,
      guest.max_people_allowed ?? "",
      guest.phone || "",
      guest.dietary || "",
      guest.notes || "",
      guest.love_message || "",
      guest.source || "",
      guest.responded_at || "",
    ]);
  }

  const csv =
    "\uFEFF" +
    rows
      .map((row) => row.map(csvCell).join(";"))
      .join("\r\n");

  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function attendanceLabel(value, language = "pt-BR") {
  const en = language === "en";
  if (value === "yes") return en ? "attending" : "vai";
  if (value === "no") return en ? "not attending" : "não vai";
  return en ? "pending" : "aguardando";
}

function statusLabelText(value, language = "pt-BR") {
  const en = language === "en";
  if (value === "yes") return en ? "Confirmed" : "Confirmado";
  if (value === "no") return en ? "Not attending" : "Não irá";
  return en ? "Pending" : "Pendente";
}

// =========================================================
// SERIALIZATION
// =========================================================

function serializeEvent(row) {
  if (!row) return null;

  const availability = getRsvpAvailability(row);
  const appearance = normalizeAppearance(safeJson(row.appearance_settings, {}));

  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    event_date: row.event_date || null,
    event_time: row.event_time || null,
    rsvp_mode: row.rsvp_mode || "free",
    welcome_message: row.welcome_message || "",
    primary_color: row.primary_color || "#b8735f",
    accent_color: row.accent_color || "#f8efec",
    background_image_url: row.background_image_url || "",
    background_video_url: row.background_video_url || "",
    background_type: normalizeBackgroundType(row.background_type),
    appearance_settings: appearance,
    public_texts: normalizePublicTexts(safeJson(row.public_texts, {}), appearance.interface_language),
    client_permissions: normalizeClientPermissions(safeJson(row.client_permissions, {})),
    list_behavior: normalizeListBehavior(row.list_behavior),
    extra_fields: normalizeExtraFields(safeJson(row.extra_fields, {})),
    status: row.status || "active",
    rsvp_deadline: row.rsvp_deadline || null,
    max_people_per_rsvp:
      row.max_people_per_rsvp === null || row.max_people_per_rsvp === undefined
        ? null
        : Number(row.max_people_per_rsvp),
    archived_at: row.archived_at || null,
    accepting_rsvp: availability.accepting,
    closed_reason: availability.reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function publicEvent(row) {
  const event = serializeEvent(row);

  return {
    id: event.id,
    title: event.title,
    slug: event.slug,
    event_date: event.event_date,
    event_time: event.event_time,
    rsvp_mode: event.rsvp_mode,
    welcome_message: event.welcome_message,
    primary_color: event.primary_color,
    accent_color: event.accent_color,
    background_image_url: event.background_image_url,
    background_video_url: event.background_video_url,
    background_type: event.background_type,
    appearance_settings: event.appearance_settings,
    public_texts: event.public_texts,
    list_behavior: event.list_behavior,
    extra_fields: event.extra_fields,
    rsvp_deadline: event.rsvp_deadline,
    max_people_per_rsvp: event.max_people_per_rsvp,
    accepting_rsvp: event.accepting_rsvp,
    closed_reason: event.closed_reason,
  };
}

function serializeGuestRow(row, members) {
  const confirmedMembers = members.filter(
    (member) => member.attendance_status === "yes"
  );

  return {
    id: row.id,
    event_id: row.event_id,
    primary_name: row.primary_name,
    group_label: row.group_label || "",
    response_status: row.response_status || "pending",
    phone: row.phone || "",
    members,
    adults: members.filter((member) => member.person_type === "adult").length,
    children: members.filter((member) => member.person_type === "child").length,
    people_count: members.length,
    confirmed_people: confirmedMembers.length,
    confirmed_adults: confirmedMembers.filter(
      (member) => member.person_type === "adult"
    ).length,
    confirmed_children: confirmedMembers.filter(
      (member) => member.person_type === "child"
    ).length,
    dietary: row.dietary || "",
    notes: row.notes || "",
    love_message: row.love_message || "",
    max_people_allowed:
      row.max_people_allowed === null || row.max_people_allowed === undefined
        ? null
        : Number(row.max_people_allowed),
    responded_at: row.responded_at || null,
    source: row.source || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at || null,
  };
}

function serializeMember(row) {
  return {
    id: row.id,
    name: row.name,
    person_type: row.person_type === "child" ? "child" : "adult",
    attendance_status: normalizeAttendanceStatus(row.attendance_status),
    is_preapproved: row.is_preapproved === undefined ? true : Boolean(row.is_preapproved),
    is_primary: Boolean(row.is_primary),
    sort_order: Number(row.sort_order || 0),
  };
}

function serializeAudit(row) {
  return {
    id: row.id,
    event_id: row.event_id,
    guest_id: row.guest_id || null,
    actor_role: row.actor_role,
    action: row.action,
    details: safeJson(row.details, {}),
    created_at: row.created_at,
  };
}

// =========================================================
// NORMALIZATION
// =========================================================

function normalizeExtraFields(fields) {
  return {
    phone: Boolean(fields?.phone),
    dietary: Boolean(fields?.dietary),
    notes: Boolean(fields?.notes),
    love_message: fields?.love_message !== false,
  };
}

function normalizeAppearance(value) {
  const source = value && typeof value === "object" ? value : {};

  return {
    background_color: safeColor(source.background_color, DEFAULT_APPEARANCE.background_color),
    card_color: safeColor(source.card_color, DEFAULT_APPEARANCE.card_color),
    text_color: safeColor(source.text_color, DEFAULT_APPEARANCE.text_color),
    muted_color: safeColor(source.muted_color, DEFAULT_APPEARANCE.muted_color),
    button_color: safeColor(source.button_color, DEFAULT_APPEARANCE.button_color),
    button_text_color: safeColor(source.button_text_color, DEFAULT_APPEARANCE.button_text_color),
    overlay_color: safeColor(source.overlay_color, DEFAULT_APPEARANCE.overlay_color),
    overlay_opacity: numberBetween(source.overlay_opacity, 0, 0.9, DEFAULT_APPEARANCE.overlay_opacity),
    card_opacity: numberBetween(source.card_opacity, 0.45, 1, DEFAULT_APPEARANCE.card_opacity),
    card_blur: numberBetween(source.card_blur, 0, 30, DEFAULT_APPEARANCE.card_blur),
    card_radius: numberBetween(source.card_radius, 8, 44, DEFAULT_APPEARANCE.card_radius),
    font_style: ["elegant", "classic", "modern", "delicate", "playful"].includes(source.font_style)
      ? source.font_style
      : DEFAULT_APPEARANCE.font_style,
    card_style: ["solid", "glass", "soft"].includes(source.card_style)
      ? source.card_style
      : DEFAULT_APPEARANCE.card_style,
    background_position: ["top", "center", "bottom"].includes(source.background_position)
      ? source.background_position
      : DEFAULT_APPEARANCE.background_position,
    background_x: ["left", "center", "right"].includes(source.background_x)
      ? source.background_x
      : DEFAULT_APPEARANCE.background_x,
    card_width: ["narrow", "medium", "wide"].includes(source.card_width)
      ? source.card_width
      : DEFAULT_APPEARANCE.card_width,
    interface_language: source.interface_language === "en" ? "en" : "pt-BR",
    invitation_url: safeOptionalStoredUrl(source.invitation_url),
    calendar_location: cleanOptionalText(source.calendar_location, 300) || "",
    calendar_end_time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(source.calendar_end_time || ""))
      ? String(source.calendar_end_time)
      : "",
    cover_url: safeOptionalStoredUrl(source.cover_url),
    logo_url: safeOptionalStoredUrl(source.logo_url),
  };
}

function normalizePublicTexts(value, language = "pt-BR") {
  const source = value && typeof value === "object" ? value : {};
  const defaults = language === "en" ? DEFAULT_PUBLIC_TEXTS_EN : DEFAULT_PUBLIC_TEXTS;
  const result = {};

  for (const [key, fallback] of Object.entries(defaults)) {
    const candidate = source[key];
    result[key] = candidate === undefined || candidate === null
      ? fallback
      : String(candidate).trim().slice(0, key.includes("message") || key === "intro" ? 500 : 120) || fallback;
  }

  return result;
}

function normalizeClientPermissions(value) {
  const source = value && typeof value === "object" ? value : {};
  const result = {};

  for (const [key, fallback] of Object.entries(DEFAULT_CLIENT_PERMISSIONS)) {
    result[key] = source[key] === undefined ? fallback : Boolean(source[key]);
  }

  return result;
}

function normalizeManagedMembers(value, fallbackStatus = "pending") {
  if (!Array.isArray(value)) return [];

  const defaultAttendance = normalizeAttendanceStatus(
    fallbackStatus === "yes" || fallbackStatus === "no" ? fallbackStatus : "pending"
  );

  return value
    .map((item) => ({
      id: item?.id ? String(item.id) : undefined,
      name: String(item?.name || "").trim().slice(0, 150),
      person_type: item?.person_type === "child" ? "child" : "adult",
      attendance_status: normalizeAttendanceStatus(
        item?.attendance_status ?? defaultAttendance
      ),
      is_preapproved: item?.is_preapproved === undefined ? true : Boolean(item.is_preapproved),
    }))
    .filter((item) => item.name)
    .slice(0, 100);
}

function normalizeAttendanceStatus(value) {
  const status = String(value || "pending").toLowerCase();
  return ["yes", "no", "pending"].includes(status) ? status : "pending";
}

function deriveGroupStatus(members, fallback = "pending") {
  if ((members || []).some((member) => member.attendance_status === "yes")) {
    return "yes";
  }

  if ((members || []).some((member) => member.attendance_status === "pending")) {
    return "pending";
  }

  if ((members || []).length && (members || []).every((member) => member.attendance_status === "no")) {
    return "no";
  }

  return allowedStatus(fallback);
}

function countMembers(members, type) {
  return (members || []).filter((member) => member.person_type === type).length;
}

function allowedStatus(value) {
  const status = String(value || "pending").toLowerCase();
  return ["yes", "no", "pending"].includes(status) ? status : "pending";
}

function allowedPublicResponse(value) {
  const status = String(value || "").toLowerCase();

  if (!['yes', 'no'].includes(status)) {
    throw new HttpError(400, "Escolha se poderá comparecer.");
  }

  return status;
}

function normalizeBackgroundType(value) {
  const type = String(value || "none").toLowerCase();
  return ["none", "image", "video"].includes(type) ? type : "none";
}

function normalizeListBehavior(value) {
  return value === "flexible" ? "flexible" : "strict";
}

function requireClientPermission(event, key) {
  const permissions = normalizeClientPermissions(safeJson(event.client_permissions, {}));

  if (!permissions[key]) {
    throw new HttpError(403, "Esta função está bloqueada para o painel da cliente.");
  }
}

// =========================================================
// UTILS
// =========================================================

async function uniqueSlug(env, title) {
  const base = slugify(title) || "evento";
  let slug = base;
  let number = 1;

  while (true) {
    const exists = await env.DB.prepare(`
      SELECT id FROM events WHERE slug = ? LIMIT 1
    `)
      .bind(slug)
      .first();

    if (!exists) return slug;

    number += 1;
    slug = `${base}-${number}`;
  }
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70);
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOptionalInteger(value, min, max) {
  if (
    value === null ||
    value === undefined ||
    String(value).trim() === ""
  ) {
    return null;
  }

  return integerBetween(value, min, max);
}

function integerBetween(value, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, number));
}

function numberBetween(value, min, max, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function safeColor(value, fallback) {
  const color = String(value || "");
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : fallback;
}

function normalizeOptionalUrl(value) {
  if (
    value === undefined ||
    value === null ||
    String(value).trim() === ""
  ) {
    return null;
  }

  const text = String(value).trim();
  let url;

  try {
    url = new URL(text);
  } catch {
    throw new HttpError(400, "A URL informada não é válida.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HttpError(400, "A mídia precisa usar um endereço http ou https.");
  }

  return url.toString();
}

function safeOptionalStoredUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(String(value));
    if (url.protocol === "https:" || url.protocol === "http:") {
      return url.toString();
    }
  } catch {}

  return "";
}

function cleanOptionalText(value, maxLength) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function cleanNullable(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function safeJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function sanitizeMetadataText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }

  let diff = 0;

  for (let index = 0; index < a.length; index++) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }

  return diff === 0;
}

function parseCookies(header) {
  const result = {};

  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    result[key] = value;
  }

  return result;
}

function hasDeadlinePassed(deadline) {
  if (!deadline) return false;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(deadline))) {
    return false;
  }

  return dateInTimeZone(RSVP_TIME_ZONE) > deadline;
}

function dateInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = {};

  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  return `${values.year}-${values.month}-${values.day}`;
}

function now() {
  return new Date().toISOString();
}

async function bodyJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...JSON_HEADERS,
      ...headers,
    },
  });
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function serveApp(request, env) {
  if (!env.ASSETS) {
    return new Response("Static Assets não configurado.", { status: 500 });
  }

  const response = await env.ASSETS.fetch(request);

  if (response.status !== 404) {
    return response;
  }

  const url = new URL(request.url);
  url.pathname = "/index.html";

  return env.ASSETS.fetch(new Request(url.toString(), request));
}
