// Read-only and intentionally minimal: never expose payments, contact details, tokens or briefings.
export async function listFlowProductionOrders(db, limit = 100) {
  const safeLimit = Math.max(1, Math.min(100, Number.isInteger(limit) ? limit : 100));
  const rows = await db.prepare(`
    SELECT o.order_code, o.honoree_display_name, o.event_type,
           o.event_date, o.status, c.name AS customer_name,
           d.folder_id AS drive_folder_id,
           (SELECT COALESCE(json_extract(i.configuration_json, '$.productCode'), i.item_code)
              FROM v2_order_items i WHERE i.order_id = o.id
                AND i.item_type = 'product' ORDER BY i.id LIMIT 1) AS product_code
      FROM v2_orders o
      INNER JOIN v2_customers c ON c.id = o.customer_id
      LEFT JOIN v2_order_drive_folders d ON d.order_code = o.order_code
     WHERE o.archived_at IS NULL AND o.status <> 'cancelled'
     ORDER BY o.created_at DESC, o.id DESC
     LIMIT ?
  `).bind(safeLimit).all();
  return (rows.results || []).map(row => ({
    orderCode: String(row.order_code),
    name: String(row.honoree_display_name || ''),
    customerName: String(row.customer_name || ''),
    eventType: String(row.event_type || ''),
    eventDate: row.event_date || null,
    status: String(row.status || ''),
    productCode: row.product_code || null,
    // Pedidos does not persist a proven publication slug; never infer it from a person's name.
    slug: null,
    driveFolderId: row.drive_folder_id || null,
    requiresPublicationMatch: true,
  }));
}
