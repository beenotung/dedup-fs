import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  // add composite index of dir.parent_id and dir.name
  await knex.schema.alterTable(`dir`, table =>
    table.index([`parent_id`, `name`]),
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`dir`, table =>
    table.dropIndex([`parent_id`, `name`]),
  )
}
