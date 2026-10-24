package com.ghostnetwork.auditor.gateway.query;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class NppesSnapshotTest {

    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void defaultPathResolvesFromRepoRootAndFromGateway(@TempDir Path root) throws IOException {
        Path snapshot = root.resolve("data").resolve("sample").resolve("nppes_snapshot.json");
        Files.createDirectories(snapshot.getParent());
        Files.writeString(snapshot, "{}");

        assertEquals(snapshot.toAbsolutePath().normalize(), NppesSnapshot.defaultPath(root));
        Path gateway = root.resolve("services").resolve("gateway");
        Files.createDirectories(gateway);
        assertEquals(snapshot.toAbsolutePath().normalize(), NppesSnapshot.defaultPath(gateway));
    }

    @Test
    void sunriseRecordUsesTheOrganizationNameAndLocationAddress() {
        Path snapshot = NppesSnapshot.defaultPath(Path.of("").toAbsolutePath());
        assertTrue(Files.isRegularFile(snapshot), snapshot.toString());
        NppesSnapshot nppes = new NppesSnapshot(mapper, snapshot.toString(), Path.of("").toAbsolutePath());

        Map<String, String> sunrise = nppes.rows(List.of("8000000009")).get(0);
        assertEquals("SUNRISE BEHAVIORAL GROUP", sunrise.get("name"));
        assertEquals("100 Harbor Sample Ave", sunrise.get("location_address_1"));
        assertEquals("NPI-2", sunrise.get("enumeration_type"));

        Map<String, String> person = nppes.rows(List.of("8000000017")).get(0);
        assertEquals("BLAKE BROOK", person.get("name"));

        assertEquals(0, nppes.rows(List.of("9999999999")).size());
    }

    @Test
    void organizationNameAndLocationWinOverMailingAndBasicName(@TempDir Path dir) throws IOException {
        Path snapshot = dir.resolve("nppes.json");
        Files.writeString(snapshot, """
                {"results":[
                  {"number":"8000000009","enumeration_type":"NPI-2",
                   "basic":{"organization_name":"SUNRISE BEHAVIORAL GROUP","name":"NOT THIS"},
                   "addresses":[
                     {"address_purpose":"MAILING","address_1":"PO BOX 1"},
                     {"address_purpose":"LOCATION","address_1":"100 Harbor Sample Ave","postal_code":"11201","telephone_number":"718-555-0100"}
                   ]},
                  {"number":"1234567893","enumeration_type":"NPI-1","basic":{"name":"ONLY NAME"}}
                ]}
                """);
        NppesSnapshot nppes = new NppesSnapshot(mapper, snapshot.toString(), dir);
        Map<String, String> sunrise = nppes.rows(List.of("8000000009")).get(0);
        assertEquals("SUNRISE BEHAVIORAL GROUP", sunrise.get("name"));
        assertEquals("100 Harbor Sample Ave", sunrise.get("location_address_1"));
        assertEquals("PO BOX 1", sunrise.get("mailing_address_1"));
        assertEquals("ONLY NAME", nppes.rows(List.of("1234567893")).get(0).get("name"));
    }

    @Test
    void missingFileDoesNotCrashAndQueriesFail(@TempDir Path dir) {
        NppesSnapshot nppes = new NppesSnapshot(mapper, dir.resolve("absent.json").toString(), dir);
        QueryUnavailableException failure = assertThrows(
                QueryUnavailableException.class,
                () -> nppes.rows(List.of("8000000009")));
        assertEquals("NPPES snapshot is not available", failure.getMessage());
    }
}
