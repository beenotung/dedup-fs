import { Knex } from 'knex'

// prettier-ignore
export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('block'))) {
    await knex.schema.createTable('block', table => {
      table.increments('id')
      table.text('hash').notNullable().unique()
      table.integer('count').notNullable()
      table.binary('chunk').notNullable()
      table.timestamps(false, true)
    })
  }

  if (!(await knex.schema.hasTable('file'))) {
    await knex.schema.createTable('file', table => {
      table.increments('id')
      table.text('name').notNullable()
      table.json('parts').notNullable()
      table.timestamps(false, true)
    })
  }
}

// prettier-ignore
export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('file')
  await knex.schema.dropTableIfExists('block')
}
