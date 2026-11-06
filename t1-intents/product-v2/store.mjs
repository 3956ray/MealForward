/** Transactional persistence. Schema installation is an explicit operator step. */
export function productStore(pool) {
  return {
    async read() {
      const result=await pool.query('SELECT data FROM mf_product_v2.state WHERE id=1');
      if (result.rowCount!==1) throw Error('PRODUCT_STORE_NOT_INITIALIZED');
      return result.rows[0].data;
    },
    async transact(change) {
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        const result=await client.query('SELECT revision,data FROM mf_product_v2.state WHERE id=1 FOR UPDATE');
        if (result.rowCount!==1) throw Error('PRODUCT_STORE_NOT_INITIALIZED');
        const state=result.rows[0].data, value=await change(state);
        await client.query('UPDATE mf_product_v2.state SET data=$1::jsonb,revision=revision+1 WHERE id=1',[JSON.stringify(state)]);
        await client.query('COMMIT');
        return value;
      } catch(error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
      finally { client.release(); }
    },
  };
}
