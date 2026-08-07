import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../shared/database/database.service';

export interface UserRow {
  id: string;
  friend_code: string | null;
  display_name: string;
  created_at: Date;
}

export interface LinkRow {
  user_id: string;
  cookie_jar: string;
  linked_at: Date;
  last_used_at: Date | null;
  invalidated_at: Date | null;
  last_error: string | null;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly db: DatabaseService) {}

  /**
   * Upserts the player identified by their CHUNITHM-NET friend code and stores
   * the encrypted cookie jar in one transaction, so a half-linked account can
   * never exist.
   */
  async linkAccount(input: {
    friendCode: string | null;
    displayName: string;
    encryptedJar: string;
  }): Promise<UserRow> {
    return this.db.transaction(async (client) => {
      const { rows } = await client.query<UserRow>(
        `insert into app.users (friend_code, display_name)
         values ($1, $2)
         on conflict (friend_code) do update
            set display_name = excluded.display_name,
                updated_at   = now()
         returning id, friend_code, display_name, created_at`,
        [input.friendCode, input.displayName],
      );

      const user = rows[0];

      await client.query(
        `insert into app.chunithm_links (user_id, cookie_jar)
         values ($1, $2)
         on conflict (user_id) do update
            set cookie_jar     = excluded.cookie_jar,
                linked_at      = now(),
                invalidated_at = null,
                last_error     = null`,
        [user.id, input.encryptedJar],
      );

      return user;
    });
  }

  findUserById(id: string): Promise<UserRow | null> {
    return this.db.queryOne<UserRow>(
      `select id, friend_code, display_name, created_at
         from app.users
        where id = $1`,
      [id],
    );
  }

  findLink(userId: string): Promise<LinkRow | null> {
    return this.db.queryOne<LinkRow>(
      'select * from app.chunithm_links where user_id = $1',
      [userId],
    );
  }

  /** Persists the refreshed jar so the next request skips the SSO round trip. */
  async saveCookieJar(userId: string, encryptedJar: string): Promise<void> {
    await this.db.query(
      `update app.chunithm_links
          set cookie_jar   = $2,
              last_used_at = now()
        where user_id = $1`,
      [userId, encryptedJar],
    );
  }

  /**
   * Flags the link as dead rather than deleting it, so the UI can tell
   * "never linked" apart from "needs relinking".
   */
  async invalidateLink(userId: string, reason: string): Promise<void> {
    await this.db.query(
      `update app.chunithm_links
          set invalidated_at = now(),
              last_error     = $2
        where user_id = $1`,
      [userId, reason],
    );
  }

  async deleteLink(userId: string): Promise<void> {
    await this.db.query('delete from app.chunithm_links where user_id = $1', [
      userId,
    ]);
  }
}
