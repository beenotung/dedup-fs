import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`dir`, table =>
    table.unique([`parent_id`, `name`]),
  )
  await knex.schema.alterTable(`file`, table =>
    table.unique([`dir_id`, `name`]),
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable(`dir`, table =>
    table.dropUnique([`parent_id`, `name`]),
  )
  await knex.schema.alterTable(`file`, table =>
    table.dropUnique([`dir_id`, `name`]),
  )
}
