import React from 'react';
import { AsyncStorage, StatusBar, View } from 'react-native';
import { AppLoading, Font, Icon } from 'expo';
import AppNavigator from './navigation/AppNavigator';
import { Provider as PaperProvider } from 'react-native-paper';
import Theme from './constants/Theme';
import monaco from './assets/fonts/monaco.ttf';

export default class App extends React.Component {
  state = {
    isLoadingComplete: false,
  };


  render() {
    if (!this.state.isLoadingComplete && !this.props.skipLoadingScreen) {
      return (
        <AppLoading startAsync={this._loadResourcesAsync} onFinish={this._handleFinishLoading} />
      );
    } else {
      return (
        <View style={{ flex: 1, backgroundColor: 'white' }}>
          <PaperProvider theme={Theme}>
            <StatusBar barStyle="light-content" />
          <AppNavigator />
          </PaperProvider>
        </View>
      );
    }
  }

  _loadResourcesAsync = async () => {
    return Font.loadAsync({
      ...Icon.Ionicons.font,
      monaco
    });
  };

  _handleFinishLoading = () => {
    // TODO
    await AsyncStorage.setItem('userId', '7566b7ca-0372-46c6-9d2c-0e9fb38bebfb');
    await AsyncStorage.setItem('userEmail', 'thorncliffeparkpubliclifepilot@gmail.com');

    this.setState({ isLoadingComplete: true });
  };
}
