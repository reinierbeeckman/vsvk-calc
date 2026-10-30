export async function applyScope(client, user) {
  await client.query("select set_config('app.user_id', $1, true)", [user.id]);
  await client.query("select set_config('app.company_id', $1, true)", [user.companyId ?? '']);
  await client.query("select set_config('app.branch_ids', $1, true)", [
    JSON.stringify(user.branchIds ?? []),
  ]);
}
