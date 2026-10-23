package com.ghostnetwork.auditor.gateway.query;

import java.util.List;
import org.springframework.stereotype.Component;

@Component
public class LiteralSqlRenderer implements SqlRenderer {

    @Override
    public String render(String preparedSql, List<Object> binds) {
        StringBuilder rendered = new StringBuilder();
        int bind = 0;
        for (int i = 0; i < preparedSql.length(); i++) {
            char ch = preparedSql.charAt(i);
            if (ch == '?') {
                rendered.append(SqlBuilder.literal(binds.get(bind)));
                bind++;
            } else {
                rendered.append(ch);
            }
        }
        if (bind != binds.size()) {
            throw new IllegalStateException("Bind count does not match placeholders");
        }
        return rendered.toString();
    }
}
