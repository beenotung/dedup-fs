import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`file`, table => table.index(`name`))
  await knex.schema.alterTable(`file`, table => table.index(`dir_id`))
  await knex.schema.alterTable(`file`, table => table.index(`mimetype_id`))
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`file`, table => table.dropIndex(`name`))
  await knex.schema.alterTable(`file`, table => table.dropIndex(`dir_id`))
  await knex.schema.alterTable(`file`, table => table.dropIndex(`mimetype_id`))
}
