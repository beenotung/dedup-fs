import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('dir', table => {
    table.foreign('parent_id').references('dir.id')
  })
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('dir', table => {
    table.dropForeign('parent_id')
  })
}
