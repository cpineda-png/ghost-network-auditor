package com.ghostnetwork.auditor.gateway.query;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.ghostnetwork.auditor.gateway.zetaris.ZetarisDriverLoader;
import java.sql.SQLException;
import org.junit.jupiter.api.Test;
import org.springframework.core.env.Environment;

class ZetarisConnectionsTest {

    @Test
    void missingDriverFailsToConnect() {
        Environment environment = mock(Environment.class);
        ZetarisDriverLoader loader = mock(ZetarisDriverLoader.class);
        when(loader.ready()).thenReturn(false);
        ZetarisConnections connections = new ZetarisConnections(environment, loader);
        assertThrows(ConnectionFailedException.class, connections::open);
    }

    @Test
    void rejectedConnectionIsAConnectionFailure() {
        Environment environment = mock(Environment.class);
        ZetarisDriverLoader loader = mock(ZetarisDriverLoader.class);
        when(loader.ready()).thenReturn(true);
        when(environment.getProperty("ZETARIS_JDBC_URL")).thenReturn("jdbc:not-a-driver:local");
        when(environment.getProperty("ZETARIS_USERNAME")).thenReturn("user");
        when(environment.getProperty("ZETARIS_PASSWORD")).thenReturn("secret");
        ZetarisConnections connections = new ZetarisConnections(environment, loader);
        ConnectionFailedException failure = assertThrows(ConnectionFailedException.class, connections::open);
        assertTrue(failure.getCause() instanceof SQLException);
        assertFalse(failure.getMessage().contains("secret"));
        assertFalse(String.valueOf(failure.getCause().getMessage()).contains("secret"));
    }
}
