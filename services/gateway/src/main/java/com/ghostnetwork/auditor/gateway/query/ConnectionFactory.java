package com.ghostnetwork.auditor.gateway.query;

import java.sql.Connection;

public interface ConnectionFactory {

    Connection open();

    ClassLoader contextClassLoader();
}
