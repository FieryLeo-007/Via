// Use the verified account and the same Supabase client as the login flow.
export async function account() {
    if (window.projectVAccount) return window.projectVAccount;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { window.removeEventListener('projectv:account', ready); reject(new Error('Account connection unavailable. Refresh and try again.')); }, 15000);
        function ready() { clearTimeout(timer); resolve(window.projectVAccount); }
        window.addEventListener('projectv:account', ready, { once: true });
    });
}
async function checked(request) {
    const { data, error } = await request;
    if (error) throw new Error(error.message || 'Unable to sync your account.');
    return data;
}
export async function getUserProfileContext() {
    const { client, user } = await account();
    const row = await checked(client.from('users').select('shirt_size,shoe_size,max_spending_budget').eq('id', user.id).single());
    return { shirtSize: row?.shirt_size || null, shoeSize: row?.shoe_size || null,
        maxSpendingBudget: row?.max_spending_budget == null ? null : Number(row.max_spending_budget) };
}
export function productKey(product) {
    return String(product.id || product.product_id || product.product_page_url || product.merchant_url || `${product.store_name}:${product.title}`);
}
async function allRows(build) {
    const rows = [];
    for (let offset = 0; ; offset += 500) {
        const page = await checked(build().range(offset, offset + 499));
        rows.push(...page);
        if (page.length < 500) return rows;
    }
}
export async function listChats() {
    const { client, user } = await account();
    return allRows(() => client.from('chats').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).order('id'));
}
export async function createChat(title, id = crypto.randomUUID()) {
    const { client, user } = await account();
    return checked(client.from('chats').upsert({ id, user_id: user.id, title }, { onConflict: 'id' }).select().single());
}
export async function saveTurn(chatId, turn) {
    const { client, user } = await account();
    return checked(client.from('chat_turns').upsert({ ...turn, chat_id: chatId, user_id: user.id }, { onConflict: 'id' }).select().single());
}
export async function loadTurns(chatId) {
    const { client, user } = await account();
    return allRows(() => client.from('chat_turns').select('*').eq('user_id', user.id).eq('chat_id', chatId).order('created_at').order('id'));
}
export async function deleteChat(id) {
    const { client, user } = await account();
    return checked(client.from('chats').delete().eq('user_id', user.id).eq('id', id));
}
export async function listSaved() {
    const { client, user } = await account();
    return allRows(() => client.from('saved_products').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).order('product_key'));
}
export async function setSaved(product, saved) {
    const { client, user } = await account();
    const key = productKey(product);
    return checked(saved
        ? client.from('saved_products').upsert({ user_id: user.id, product_key: key, product_data: product }, { onConflict: 'user_id,product_key' })
        : client.from('saved_products').delete().eq('user_id', user.id).eq('product_key', key));
}
