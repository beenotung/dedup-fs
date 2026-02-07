import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('dir', table => {
    table.renameColumn('ctime', 'birth_time')
    table.renameColumn('mtime', 'modify_time')
  })
  await knex.schema.alterTable('file', table => {
    table.renameColumn('ctime', 'birth_time')
    table.renameColumn('mtime', 'modify_time')
  })
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('dir', table => {
    table.renameColumn('modify_time', 'mtime')
    table.renameColumn('birth_time', 'ctime')
  })
  await knex.schema.alterTable('file', table => {
    table.renameColumn('modify_time', 'mtime')
    table.renameColumn('birth_time', 'ctime')
  })
}
