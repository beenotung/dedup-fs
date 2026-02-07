import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`dir`, table => table.index(`name`))
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`dir`, table => table.dropIndex(`name`))
}
