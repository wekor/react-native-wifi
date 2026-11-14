import { StyleSheet, Text, View } from 'react-native';
import { colors, textStyles } from './text';

/** Label–value rows; entries without a value are left out. */
export const KeyValue = ({
  entries,
}: {
  entries: [string, string | number | undefined][];
}) => (
  <View style={styles.list}>
    {entries
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => (
        <View key={key} style={styles.row}>
          <Text style={styles.key}>{key}</Text>
          <Text selectable style={textStyles.mono}>
            {value}
          </Text>
        </View>
      ))}
  </View>
);

const styles = StyleSheet.create({
  list: { gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  key: { fontSize: 13, color: colors.muted },
});
